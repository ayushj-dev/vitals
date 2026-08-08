import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { CLIENT_CLOSED_STATUS, UNMATCHED_ROUTE, type VitalsEngine } from "@vitalsjs/core";
import { dashboardHtml } from "@vitalsjs/ui";
import { type Request, type RequestHandler, type Response, Router } from "express";

export type VitalsRouterOptions = {
	engine: VitalsEngine;
	/**
	 * Decides whether a request may view the dashboard.
	 *
	 * Defaults to loopback-only. The dashboard exposes the Node version, CPU model, PID and
	 * host memory, so it must not be world-readable unless that is an explicit choice.
	 */
	authorize?: (req: Request) => boolean | Promise<boolean>;
};

/**
 * Records every request against the engine.
 *
 * Mount before your routes so the timer covers the whole handler chain.
 *
 * Recording happens on `close`, not `finish`: `finish` never fires when the client aborts,
 * which would both lose the request and leak the in-flight counter upward. Aborted requests
 * are recorded as 499 so they are visible rather than counted as whatever status was pending.
 */
export function vitalsMiddleware(engine: VitalsEngine): RequestHandler {
	return (req, res, next) => {
		const startedAt = performance.now();
		engine.startRequest();

		res.once("close", () => {
			engine.recordRequest({
				method: req.method,
				route: routeKey(req),
				statusCode: res.writableFinished ? res.statusCode : CLIENT_CLOSED_STATUS,
				durationMs: performance.now() - startedAt,
			});
		});

		next();
	};
}

/**
 * Builds the dashboard router. Mount it wherever you like:
 *
 * ```ts
 * app.use("/status", createVitalsRouter({ engine }));
 * ```
 */
export function createVitalsRouter(options: VitalsRouterOptions): Router {
	const router = Router();
	const { engine } = options;
	const authorize = options.authorize ?? isLoopback;

	const guard: RequestHandler = (req, res, next) => {
		Promise.resolve(authorize(req))
			.then((allowed) => {
				if (allowed) return next();
				res.status(403).type("text/plain").send("Forbidden");
			})
			.catch(() => {
				res.status(403).type("text/plain").send("Forbidden");
			});
	};

	router.use(guard);

	// Static HTML with no interpolation, so Express's ETag turns reloads into 304s.
	router.get("/", (_req, res) => {
		const nonce = randomUUID();

		res.set(
			"Content-Security-Policy",
			[
				`script-src 'self' 'nonce-${nonce}'`,
				`style-src 'self' 'nonce-${nonce}'`,
				`img-src 'self' data:`,
				`font-src 'self' data:`,
			].join("; "),
		);

		res.type("html").send(dashboardHtml.replaceAll("__VITALS_CSP_NONCE__", nonce));
	});

	// Static info and history arrive in the stream's init frame, so there is no /history route.
	router.get("/events", (_req, res: Response) => {
		engine.broadcaster.addClient(res);
	});

	return router;
}

/**
 * Full route pattern for a request.
 *
 * `req.route.path` is only the portion after the mount prefix, so `req.baseUrl` is needed to
 * distinguish routes across mounted routers. Requests that matched nothing collapse into a
 * single key: using `req.path` there would let any scanner hitting random URLs fill the
 * collector's route cap with junk and evict the real routes.
 */
function routeKey(req: Request): string {
	const pattern = req.route?.path;

	if (typeof pattern !== "string") return UNMATCHED_ROUTE;

	const base = req.baseUrl || "";
	const full = pattern === "/" ? base || "/" : `${base}${pattern}`;

	return full || "/";
}

function isLoopback(req: Request): boolean {
	const ip = req.ip ?? req.socket.remoteAddress ?? "";

	return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
