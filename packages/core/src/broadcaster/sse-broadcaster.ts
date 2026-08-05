import type { ServerResponse } from "node:http";
import type { MetricSnapshot, VitalsInitPayload } from "../engine/engine";

export type SSEBroadcasterOptions = {
	/** Comment frames that keep proxies from closing idle connections. @default 15000 */
	heartbeatIntervalMs?: number;
	/** Concurrent dashboards allowed. @default 20 */
	maxClients?: number;
};

/**
 * Streams metric snapshots to dashboards over Server-Sent Events.
 */
export class SSEBroadcaster {
	private readonly clients = new Set<ServerResponse>();
	private readonly heartbeatIntervalMs: number;
	private readonly maxClients: number;
	private readonly getInitPayload: () => VitalsInitPayload;
	private heartbeatTimer: NodeJS.Timeout | null = null;

	constructor(getInitPayload: () => VitalsInitPayload, options: SSEBroadcasterOptions = {}) {
		this.getInitPayload = getInitPayload;
		this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
		this.maxClients = options.maxClients ?? 20;
	}

	/**
	 * Attaches a client and immediately sends the init frame carrying static info and history.
	 * Returns false if the client cap is already reached.
	 */
	public addClient(res: ServerResponse): boolean {
		if (this.clients.size >= this.maxClients) {
			res.writeHead(503, { "Content-Type": "text/plain", "Retry-After": "30" });
			res.end("Too many dashboard connections");
			return false;
		}

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});

		res.socket?.setNoDelay(true);

		res.write(`retry: 3000\n\n`);
		res.write(`event: init\ndata: ${JSON.stringify(this.getInitPayload())}\n\n`);

		this.clients.add(res);
		this.startHeartbeat();

		const remove = () => {
			this.clients.delete(res);
			this.stopHeartbeatIfIdle();
		};

		res.once("close", remove);
		res.once("error", remove);

		return true;
	}

	/**
	 * Sends a snapshot to every client, serializing once for all of them.
	 */
	public broadcast(snapshot: MetricSnapshot): void {
		if (this.clients.size === 0) return;

		this.write(`data: ${JSON.stringify(snapshot)}\n\n`);
	}

	public get clientCount(): number {
		return this.clients.size;
	}

	public destroy(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}

		for (const client of this.clients) {
			client.end();
		}

		this.clients.clear();
	}

	private write(payload: string): void {
		for (const client of this.clients) {
			if (client.writableEnded || client.destroyed) {
				this.clients.delete(client);
				continue;
			}

			// Skip clients that have not drained. Queueing for a stalled reader would grow the
			// host process's memory without bound, and a live dashboard has no use for stale
			// frames anyway.
			if (client.writableNeedDrain) continue;

			client.write(payload);
		}

		this.stopHeartbeatIfIdle();
	}

	private startHeartbeat(): void {
		if (this.heartbeatTimer) return;

		this.heartbeatTimer = setInterval(() => this.write(": ping\n\n"), this.heartbeatIntervalMs);
		this.heartbeatTimer.unref();
	}

	private stopHeartbeatIfIdle(): void {
		if (this.heartbeatTimer && this.clients.size === 0) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}
}
