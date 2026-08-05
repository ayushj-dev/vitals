import { describe, expect, it } from "vitest";
import { GcCollector } from "../src/collectors/gc";
import { VitalsEngine } from "../src/engine/engine";

describe("GcCollector", () => {
	it("reports window deltas and lifetime totals separately", async () => {
		const collector = new GcCollector();

		// Force real collections so the observer fires.
		for (let i = 0; i < 200; i++) void new Array(50_000).fill(i);
		await new Promise((resolve) => setTimeout(resolve, 50));

		const first = collector.collect();
		const second = collector.collect();

		// The window drains; the lifetime total does not. Charting the total would only ramp.
		expect(second.pauseMs).toBe(0);
		expect(second.count).toBe(0);
		expect(second.totalPauseMs).toBe(first.totalPauseMs);
		expect(second.totalCount).toBe(first.totalCount);

		collector.destroy();
	});

	it("classifies a major collection as major", async () => {
		// vitest.config.ts passes --expose-gc. Asserting it is present rather than skipping,
		// because a silently skipped test is exactly how the wrong constant survived before.
		const forceGc = (globalThis as { gc?: () => void }).gc;
		expect(forceGc).toBeTypeOf("function");

		const collector = new GcCollector();
		forceGc?.();
		await new Promise((resolve) => setTimeout(resolve, 50));

		// Comparing kind against 2 (a flags value) reported every collection as minor.
		const metrics = collector.collect();
		expect(metrics.majorCount).toBeGreaterThan(0);
		expect(metrics.majorCount + metrics.minorCount).toBe(metrics.count);

		collector.destroy();
	});
});

describe("VitalsEngine", () => {
	it("serializes history as JSON arrays", async () => {
		const engine = new VitalsEngine({ sampleIntervalMs: 10 });
		engine.start();
		await new Promise((resolve) => setTimeout(resolve, 40));

		// Float64Array would serialize as {"0":...}, which is what stopped history from loading.
		const history = JSON.parse(JSON.stringify(engine.getHistory()));
		expect(Array.isArray(history.timestamps)).toBe(true);
		expect(Array.isArray(history.cpuPercent)).toBe(true);
		expect(Array.isArray(history.heapUsedBytes)).toBe(true);
		expect(history.timestamps.length).toBeGreaterThan(0);

		engine.stop();
	});

	it("restarts cleanly after stop", async () => {
		const engine = new VitalsEngine({ sampleIntervalMs: 10 });

		engine.start();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(engine.getSnapshot()).not.toBeNull();

		engine.stop();
		expect(engine.isRunning).toBe(false);

		// The event loop histogram and GC observer are recreated, so sampling resumes.
		engine.start();
		const before = engine.getHistory().timestamps.length;
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(engine.getHistory().timestamps.length).toBeGreaterThan(before);

		engine.stop();
	});

	it("records requests through the engine into the snapshot", async () => {
		const engine = new VitalsEngine({ sampleIntervalMs: 10 });
		engine.start();

		engine.recordRequest({ method: "GET", route: "/x", statusCode: 200, durationMs: 5 });
		await new Promise((resolve) => setTimeout(resolve, 40));

		const snapshot = engine.getSnapshot();
		expect(snapshot?.http.totalRequests).toBe(1);
		expect(snapshot?.http.routes[0]?.key).toBe("GET /x");

		engine.stop();
	});

	it("keeps sampling when a collector throws", async () => {
		const engine = new VitalsEngine({ sampleIntervalMs: 10 });
		engine.start();

		// An uncaught throw from a timer callback would kill the host process.
		const collector = Reflect.get(engine, "memoryCollector") as { collect: () => unknown };
		const original = collector.collect;
		collector.collect = () => {
			throw new Error("boom");
		};

		await new Promise((resolve) => setTimeout(resolve, 40));
		collector.collect = original;

		expect(engine.isRunning).toBe(true);
		engine.stop();
	});
});
