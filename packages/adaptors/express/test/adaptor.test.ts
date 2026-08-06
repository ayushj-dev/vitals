import type { HttpRequestMetric, VitalsEngine } from "@vitalsjs/core";
import express from "express";
import { describe, expect, it } from "vitest";
import { createVitalsRouter, vitalsMiddleware } from "../src/index";

function serve(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
	return new Promise((resolve) => {
		const server = app.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;

			resolve({
				url: `http://127.0.0.1:${port}`,
				close: () => new Promise((done) => server.close(() => done())),
			});
		});
	});
}

/** Captures what the middleware reports, so route keys can be asserted without timers. */
function capturingEngine() {
	const recorded: HttpRequestMetric[] = [];
	const counters = { started: 0 };
	const engine = {
		startRequest: () => counters.started++,
		recordRequest: (metric: HttpRequestMetric) => recorded.push(metric),
	} as unknown as VitalsEngine;

	return { recorded, counters, engine };
}

describe("vitalsMiddleware", () => {
	it("includes the mount prefix so routes stay distinct across mounted routers", async () => {
		const { recorded, engine } = capturingEngine();
		const app = express();
		app.use(vitalsMiddleware(engine));

		const api = express.Router();
		api.get("/users/:id", (_req, res) => res.send("ok"));
		app.use("/api/v1", api);

		const server = await serve(app);
		await fetch(`${server.url}/api/v1/users/7`);
		await server.close();

		// Without req.baseUrl this reads "/users/:id" and collides with every other mount.
		expect(recorded[0]?.route).toBe("/api/v1/users/:id");
		expect(recorded[0]?.method).toBe("GET");
	});

	it("keeps the pattern rather than the concrete path", async () => {
		const { recorded, engine } = capturingEngine();
		const app = express();
		app.use(vitalsMiddleware(engine));
		app.get("/users/:id/posts/:postId", (_req, res) => res.send("ok"));

		const server = await serve(app);
		await fetch(`${server.url}/users/7/posts/42`);
		await server.close();

		expect(recorded[0]?.route).toBe("/users/:id/posts/:postId");
	});

	it("collapses every unmatched path into one key", async () => {
		const { recorded, engine } = capturingEngine();
		const app = express();
		app.use(vitalsMiddleware(engine));
		app.get("/known", (_req, res) => res.send("ok"));

		const server = await serve(app);
		for (let i = 0; i < 25; i++) await fetch(`${server.url}/wp-admin/random-${i}`);
		await server.close();

		// Keying 404s by req.path would let a scanner fill the collector's route cap with junk.
		expect(new Set(recorded.map((metric) => metric.route))).toEqual(new Set(["__unmatched__"]));
		expect(recorded.every((metric) => metric.statusCode === 404)).toBe(true);
	});

	it("reports the final status code and a non-negative duration", async () => {
		const { recorded, engine } = capturingEngine();
		const app = express();
		app.use(vitalsMiddleware(engine));
		app.get("/boom", (_req, res) => res.status(503).send("nope"));

		const server = await serve(app);
		await fetch(`${server.url}/boom`);
		await server.close();

		expect(recorded[0]?.statusCode).toBe(503);
		expect(recorded[0]?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("records an aborted request as 499 and still pairs it with its start", async () => {
		const { recorded, counters, engine } = capturingEngine();
		const app = express();
		app.use(vitalsMiddleware(engine));
		app.get("/slow", () => {
			/* never responds, so the client's abort is the only thing that ends it */
		});

		const server = await serve(app);
		const controller = new AbortController();
		const pending = fetch(`${server.url}/slow`, { signal: controller.signal });
		// Give Express time to enter the handler before pulling the connection.
		await new Promise((resolve) => setTimeout(resolve, 50));
		controller.abort();
		await expect(pending).rejects.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 50));
		await server.close();

		// `finish` never fires here, so recording on it would lose the request and leave the
		// in-flight counter permanently one higher.
		expect(counters.started).toBe(1);
		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.statusCode).toBe(499);
	});
});

describe("createVitalsRouter", () => {
	it("serves the dashboard and the stream under any mount path", async () => {
		const { VitalsEngine: Engine } = await import("@vitalsjs/core");
		const engine = new Engine().start();
		const app = express();
		app.use("/admin/health", createVitalsRouter({ engine }));

		const server = await serve(app);

		const page = await fetch(`${server.url}/admin/health`);
		expect(page.status).toBe(200);
		expect(page.headers.get("content-type")).toContain("text/html");
		expect(await page.text()).toContain("<title>Vitals");

		const stream = await fetch(`${server.url}/admin/health/events`, {
			headers: { Accept: "text/event-stream" },
		});
		expect(stream.headers.get("content-type")).toContain("text/event-stream");

		// History and static info arrive here, which is why there is no /history route.
		const reader = stream.body?.getReader();
		const chunk = await reader?.read();
		const text = new TextDecoder().decode(chunk?.value);
		expect(text).toContain("event: init");
		expect(text).toContain('"timestamps"');
		await reader?.cancel();

		await server.close();
		engine.stop();
	});

	it("denies non-loopback callers by default", async () => {
		const { VitalsEngine: Engine } = await import("@vitalsjs/core");
		const app = express();
		app.set("trust proxy", true);
		app.use("/status", createVitalsRouter({ engine: new Engine() }));

		const server = await serve(app);
		// trust proxy makes req.ip follow the header, standing in for a remote client.
		const response = await fetch(`${server.url}/status`, {
			headers: { "X-Forwarded-For": "203.0.113.9" },
		});

		expect(response.status).toBe(403);
		await server.close();
	});

	it("honours a custom authorize callback", async () => {
		const { VitalsEngine: Engine } = await import("@vitalsjs/core");
		const app = express();
		app.use(
			"/status",
			createVitalsRouter({
				engine: new Engine(),
				authorize: (req) => req.headers.authorization === "let-me-in",
			}),
		);

		const server = await serve(app);

		expect((await fetch(`${server.url}/status`)).status).toBe(403);
		expect(
			(await fetch(`${server.url}/status`, { headers: { authorization: "let-me-in" } })).status,
		).toBe(200);

		await server.close();
	});
});
