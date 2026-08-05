import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { SSEBroadcaster } from "../src/broadcaster/sse-broadcaster";
import type { MetricSnapshot, VitalsInitPayload } from "../src/engine/engine";

const initPayload = {
	staticInfo: { pid: 1 },
	history: { timestamps: [1, 2] },
	sampleIntervalMs: 1000,
} as unknown as VitalsInitPayload;

const snapshot = { timestamp: 1, http: { totalRequests: 0 } } as unknown as MetricSnapshot;

function fakeClient(overrides: Partial<ServerResponse> = {}) {
	const writes: string[] = [];

	return {
		writes,
		res: {
			writableEnded: false,
			destroyed: false,
			writableNeedDrain: false,
			socket: { setNoDelay: () => {} },
			writeHead: () => {},
			end: () => {},
			once: () => {},
			write: (chunk: string) => {
				writes.push(chunk);
				return true;
			},
			...overrides,
		} as unknown as ServerResponse,
	};
}

describe("SSEBroadcaster", () => {
	it("sends an init frame carrying static info and history", () => {
		const broadcaster = new SSEBroadcaster(() => initPayload);
		const client = fakeClient();

		broadcaster.addClient(client.res);

		const init = client.writes.find((chunk) => chunk.startsWith("event: init"));
		expect(init).toBeDefined();
		expect(init).toContain('"timestamps":[1,2]');

		broadcaster.destroy();
	});

	it("skips clients that have not drained", () => {
		const broadcaster = new SSEBroadcaster(() => initPayload);
		const stalled = fakeClient({ writableNeedDrain: true });
		const healthy = fakeClient();

		broadcaster.addClient(stalled.res);
		broadcaster.addClient(healthy.res);

		const before = stalled.writes.length;
		broadcaster.broadcast(snapshot);

		// Queueing frames for a stalled reader would grow host memory without bound.
		expect(stalled.writes.length).toBe(before);
		expect(healthy.writes.some((chunk) => chunk.startsWith("data:"))).toBe(true);

		broadcaster.destroy();
	});

	it("rejects clients past the cap", () => {
		const broadcaster = new SSEBroadcaster(() => initPayload, { maxClients: 1 });

		expect(broadcaster.addClient(fakeClient().res)).toBe(true);
		expect(broadcaster.addClient(fakeClient().res)).toBe(false);
		expect(broadcaster.clientCount).toBe(1);

		broadcaster.destroy();
	});

	it("drops clients whose socket is gone", () => {
		const broadcaster = new SSEBroadcaster(() => initPayload);
		const client = fakeClient();

		broadcaster.addClient(client.res);
		(client.res as { destroyed: boolean }).destroyed = true;
		broadcaster.broadcast(snapshot);

		expect(broadcaster.clientCount).toBe(0);

		broadcaster.destroy();
	});
});
