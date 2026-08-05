import { RingBuffer } from "../registry/ring-buffer";

/** Route key used for anything that did not match a route (404s, pre-routing rejections). */
export const UNMATCHED_ROUTE = "__unmatched__";

/** Route key used once the cardinality cap is reached. */
export const OVERFLOW_ROUTE = "__other__";

/** Status recorded when the client disconnected before the response finished. */
export const CLIENT_CLOSED_STATUS = 499;

/** Distinct status codes retained. Real codes are bounded; this guards against odd ones. */
const MAX_STATUS_CODES = 64;

export type HttpRequestMetric = {
	method: string;
	route: string;
	statusCode: number;
	durationMs: number;
};

/** Latency figures derived from one pass over the retained samples. */
export type LatencySummary = {
	readonly avgLatencyMs: number;
	readonly p95LatencyMs: number;
	readonly p99LatencyMs: number;
	readonly maxLatencyMs: number;
};

export type RouteStats = LatencySummary & {
	readonly key: string;
	readonly totalRequests: number;
	/** Requests during the last sampling window. */
	readonly requests: number;
	readonly clientErrorCount: number;
	readonly serverErrorCount: number;
};

export type StatusClassCounts = {
	readonly informational: number;
	readonly success: number;
	readonly redirect: number;
	readonly clientError: number;
	readonly serverError: number;
};

export type HttpMetrics = LatencySummary & {
	readonly totalRequests: number;
	readonly requestsPerSecond: number;
	/** Requests currently being handled. */
	readonly inFlight: number;
	/** Status classes seen during the last sampling window. */
	readonly statusClasses: StatusClassCounts;
	/** Lifetime count per exact status code, for the breakdown table. */
	readonly statusCodes: Record<number, number>;
	/** Busiest routes this window. Capped so the payload stays small at high cardinality. */
	readonly routes: readonly RouteStats[];
	/** Distinct route keys currently tracked. */
	readonly trackedRoutes: number;
};

export type HttpCollectorOptions = {
	/**
	 * Hard cap on tracked route keys, including the `__other__` bucket that the rest fold into.
	 * @default 100
	 */
	maxRoutes?: number;
	/** Latency samples retained per route for avg/p95/p99/max. @default 128 */
	latencySamples?: number;
	/** Routes included in each snapshot, busiest first. @default 8 */
	topRoutes?: number;
};

class RouteTracker {
	public readonly latencies: RingBuffer;
	public totalRequests = 0;
	public windowRequests = 0;
	public clientErrorCount = 0;
	public serverErrorCount = 0;

	constructor(latencySamples: number) {
		this.latencies = new RingBuffer(latencySamples);
	}

	public record(statusCode: number, durationMs: number): void {
		this.totalRequests++;
		this.windowRequests++;
		this.latencies.push(durationMs);

		if (statusCode >= 500) {
			this.serverErrorCount++;
		} else if (statusCode >= 400) {
			this.clientErrorCount++;
		}
	}

	public stats(key: string): RouteStats {
		return {
			key,
			totalRequests: this.totalRequests,
			requests: this.windowRequests,
			clientErrorCount: this.clientErrorCount,
			serverErrorCount: this.serverErrorCount,
			...summarize(this.latencies.toArray()),
		};
	}
}

/**
 * Aggregates HTTP throughput, latency, status codes and in-flight count.
 *
 * Route cardinality is capped so that unbounded route keys cannot exhaust memory.
 */
export class HttpCollector {
	private readonly maxRoutes: number;
	private readonly latencySamples: number;
	private readonly topRoutes: number;
	private readonly routes = new Map<string, RouteTracker>();
	private readonly latencies: RingBuffer;
	private readonly statusCodes = new Map<number, number>();

	private totalRequests = 0;
	private windowRequests = 0;
	private inFlight = 0;
	private lastSampleMs = Date.now();

	// Mutable counters: a fresh object per request would allocate on the hottest path.
	private status1xx = 0;
	private status2xx = 0;
	private status3xx = 0;
	private status4xx = 0;
	private status5xx = 0;

	constructor(options: HttpCollectorOptions = {}) {
		// Two is the floor: one named route plus the overflow bucket.
		this.maxRoutes = Math.max(2, options.maxRoutes ?? 100);
		this.latencySamples = options.latencySamples ?? 128;
		this.topRoutes = options.topRoutes ?? 8;
		this.latencies = new RingBuffer(this.latencySamples);
	}

	/**
	 * Marks a request as started. Must be paired with `record`, which is why adaptors report
	 * on the response's `close` event: `finish` never fires for an aborted request, so pairing
	 * with it would leak this counter upward on every client disconnect.
	 */
	public startRequest(): void {
		this.inFlight++;
	}

	/**
	 * Records a completed request. Runs on every request, so it stays allocation-light.
	 */
	public record(metric: HttpRequestMetric): void {
		if (this.inFlight > 0) this.inFlight--;

		this.totalRequests++;
		this.windowRequests++;
		this.latencies.push(metric.durationMs);
		this.countStatus(metric.statusCode);

		// req.method is already uppercase in Node, so no normalization is needed here.
		const key = `${metric.method} ${metric.route}`;
		let tracker = this.routes.get(key);

		if (!tracker) {
			tracker = this.createTracker(key);
		}

		tracker.record(metric.statusCode, metric.durationMs);
	}

	/**
	 * Returns the window's HTTP metrics and resets the window accumulators.
	 */
	public collect(): HttpMetrics {
		const now = Date.now();
		const elapsedSec = (now - this.lastSampleMs) / 1000;
		const requestsPerSecond = elapsedSec > 0 ? this.windowRequests / elapsedSec : 0;

		const metrics: HttpMetrics = {
			totalRequests: this.totalRequests,
			requestsPerSecond: Math.round(requestsPerSecond * 100) / 100,
			inFlight: this.inFlight,
			...summarize(this.latencies.toArray()),
			statusClasses: {
				informational: this.status1xx,
				success: this.status2xx,
				redirect: this.status3xx,
				clientError: this.status4xx,
				serverError: this.status5xx,
			},
			statusCodes: Object.fromEntries(this.statusCodes),
			routes: this.busiestRoutes(),
			trackedRoutes: this.routes.size,
		};

		this.lastSampleMs = now;
		this.windowRequests = 0;
		this.status1xx = 0;
		this.status2xx = 0;
		this.status3xx = 0;
		this.status4xx = 0;
		this.status5xx = 0;
		for (const tracker of this.routes.values()) {
			tracker.windowRequests = 0;
		}

		return metrics;
	}

	private createTracker(key: string): RouteTracker {
		const overflow = this.routes.get(OVERFLOW_ROUTE);
		if (overflow) return overflow;

		// The last slot is reserved for the overflow bucket so that the total number of tracked
		// keys never exceeds maxRoutes.
		if (this.routes.size >= this.maxRoutes - 1) {
			const bucket = new RouteTracker(this.latencySamples);
			this.routes.set(OVERFLOW_ROUTE, bucket);

			return bucket;
		}

		const tracker = new RouteTracker(this.latencySamples);
		this.routes.set(key, tracker);

		return tracker;
	}

	/**
	 * Computes stats only for the routes actually emitted; deriving them for every tracked
	 * route would sort a copy of each route's latency samples on every tick.
	 */
	private busiestRoutes(): RouteStats[] {
		const entries = [...this.routes.entries()].sort(
			([, a], [, b]) => b.windowRequests - a.windowRequests || b.totalRequests - a.totalRequests,
		);

		return entries.slice(0, this.topRoutes).map(([key, tracker]) => tracker.stats(key));
	}

	private countStatus(statusCode: number): void {
		if (statusCode >= 500) this.status5xx++;
		else if (statusCode >= 400) this.status4xx++;
		else if (statusCode >= 300) this.status3xx++;
		else if (statusCode >= 200) this.status2xx++;
		else this.status1xx++;

		const seen = this.statusCodes.get(statusCode);

		if (seen !== undefined) {
			this.statusCodes.set(statusCode, seen + 1);
		} else if (this.statusCodes.size < MAX_STATUS_CODES) {
			this.statusCodes.set(statusCode, 1);
		}
	}
}

/**
 * Derives every latency figure from a single sort, since avg, p95, p99 and max would
 * otherwise each walk or re-sort the same samples.
 */
function summarize(samples: number[]): LatencySummary {
	if (samples.length === 0) {
		return { avgLatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, maxLatencyMs: 0 };
	}

	// Numeric comparator is required: Array.prototype.sort is lexicographic by default,
	// which would order [9, 100] as [100, 9].
	const sorted = samples.sort((a, b) => a - b);

	let sum = 0;
	for (const sample of sorted) sum += sample;

	return {
		avgLatencyMs: round(sum / sorted.length),
		p95LatencyMs: round(at(sorted, 95)),
		p99LatencyMs: round(at(sorted, 99)),
		maxLatencyMs: round(sorted[sorted.length - 1] as number),
	};
}

function at(sorted: number[], p: number): number {
	const index = Math.min(Math.floor((sorted.length * p) / 100), sorted.length - 1);

	return sorted[index] as number;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
