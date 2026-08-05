import { describe, expect, it } from "vitest";
import { HttpCollector, OVERFLOW_ROUTE } from "../src/collectors/http";
import { RingBuffer } from "../src/registry/ring-buffer";

describe("RingBuffer", () => {
	it("returns values oldest-first after wrapping", () => {
		const buffer = new RingBuffer(3);

		for (const value of [1, 2, 3, 4, 5]) buffer.push(value);

		expect(buffer.toArray()).toEqual([3, 4, 5]);
	});

	it("returns only what has been written before it is full", () => {
		const buffer = new RingBuffer(5);
		buffer.push(1);
		buffer.push(2);

		expect(buffer.toArray()).toEqual([1, 2]);
	});

	it("rejects a capacity that would make the modulo produce NaN", () => {
		expect(() => new RingBuffer(0)).toThrow(RangeError);
		expect(() => new RingBuffer(-1)).toThrow(RangeError);
		expect(() => new RingBuffer(1.5)).toThrow(RangeError);
	});

	it("survives a JSON round trip as an array", () => {
		const buffer = new RingBuffer(2);
		buffer.push(1);
		buffer.push(2);

		// A Float64Array would serialize as {"0":1,"1":2} and break every consumer.
		expect(JSON.parse(JSON.stringify({ v: buffer.toArray() })).v).toEqual([1, 2]);
	});
});

describe("HttpCollector", () => {
	const request = (route: string, statusCode = 200, durationMs = 1) => ({
		method: "GET",
		route,
		statusCode,
		durationMs,
	});

	it("computes p95 numerically rather than lexicographically", () => {
		const collector = new HttpCollector();

		// Sorted as strings, [9, 100] would order as [100, 9] and report the wrong p95.
		for (const ms of [9, 100]) collector.record(request("/a", 200, ms));

		expect(collector.collect().p95LatencyMs).toBe(100);
	});

	it("caps route cardinality instead of growing without bound", () => {
		const collector = new HttpCollector({ maxRoutes: 3 });

		for (let i = 0; i < 50; i++) collector.record(request(`/r${i}`));

		const metrics = collector.collect();
		expect(metrics.trackedRoutes).toBe(3);
		expect(metrics.totalRequests).toBe(50);
		expect(metrics.routes.some((route) => route.key === OVERFLOW_ROUTE)).toBe(true);
	});

	it("emits at most topRoutes entries, busiest first", () => {
		const collector = new HttpCollector({ topRoutes: 2 });

		collector.record(request("/quiet"));
		for (let i = 0; i < 5; i++) collector.record(request("/busy"));
		for (let i = 0; i < 3; i++) collector.record(request("/middle"));

		const routes = collector.collect().routes;
		expect(routes).toHaveLength(2);
		expect(routes[0]?.key).toBe("GET /busy");
		expect(routes[1]?.key).toBe("GET /middle");
	});

	it("counts status classes per window and resets them", () => {
		const collector = new HttpCollector();

		collector.record(request("/a", 200));
		collector.record(request("/a", 404));
		collector.record(request("/a", 500));

		expect(collector.collect().statusClasses).toMatchObject({
			success: 1,
			clientError: 1,
			serverError: 1,
		});

		// Window counters must drain, otherwise the chart accumulates instead of showing rate.
		expect(collector.collect().statusClasses).toMatchObject({
			success: 0,
			clientError: 0,
			serverError: 0,
		});
	});

	it("derives per-route p99 and max numerically", () => {
		const collector = new HttpCollector();

		for (const ms of [5, 9, 100, 7]) collector.record(request("/a", 200, ms));

		// A lexicographic sort would put 100 first and report max as 9.
		expect(collector.collect().routes[0]).toMatchObject({ p99LatencyMs: 100, maxLatencyMs: 100 });
	});

	it("tracks in-flight requests and does not go negative", () => {
		const collector = new HttpCollector();

		collector.startRequest();
		collector.startRequest();
		expect(collector.collect().inFlight).toBe(2);

		collector.record(request("/a"));
		expect(collector.collect().inFlight).toBe(1);

		// An adaptor that records without a matching start must not underflow the counter.
		collector.record(request("/a"));
		collector.record(request("/a"));
		expect(collector.collect().inFlight).toBe(0);
	});

	it("caps the number of distinct status codes retained", () => {
		const collector = new HttpCollector();

		for (let code = 100; code < 300; code++) collector.record(request("/a", code));

		const codes = collector.collect().statusCodes;
		expect(Object.keys(codes)).toHaveLength(64);
		// Codes already being counted keep counting once the cap is reached.
		collector.record(request("/a", 100));
		expect(collector.collect().statusCodes[100]).toBe(2);
	});

	it("keeps lifetime totals while resetting the window", () => {
		const collector = new HttpCollector();

		collector.record(request("/a"));
		collector.collect();
		collector.record(request("/a"));

		const metrics = collector.collect();
		expect(metrics.totalRequests).toBe(2);
		expect(metrics.routes[0]?.requests).toBe(1);
		expect(metrics.routes[0]?.totalRequests).toBe(2);
	});
});
