import { constants, PerformanceObserver } from "node:perf_hooks";

export type GcMetrics = {
	/** GC pause time accumulated during the last sampling window. */
	readonly pauseMs: number;
	/** Collections during the last sampling window. */
	readonly count: number;
	readonly majorCount: number;
	readonly minorCount: number;
	/** Lifetime totals, for at-a-glance context rather than charting. */
	readonly totalPauseMs: number;
	readonly totalCount: number;
};

/** `detail` is present on gc entries at runtime but absent from the PerformanceEntry type. */
type GcPerformanceEntry = { duration: number; detail?: { kind?: number } };

/**
 * Captures V8 garbage collection pauses via PerformanceObserver.
 *
 * Note: the observer allocates a PerformanceEntry per collection, so its cost scales
 * with GC frequency rather than with the sampling rate. It is the only part of the
 * engine whose overhead is not fixed.
 */
export class GcCollector {
	private observer: PerformanceObserver | null = null;

	private totalPauseMs = 0;
	private totalCount = 0;

	// Window accumulators, drained on every collect().
	private pauseMs = 0;
	private count = 0;
	private majorCount = 0;
	private minorCount = 0;

	constructor() {
		this.observer = new PerformanceObserver((list) => {
			for (const raw of list.getEntries()) {
				const entry = raw as unknown as GcPerformanceEntry;
				const kind = entry.detail?.kind;

				this.count++;
				this.pauseMs += entry.duration;
				this.totalCount++;
				this.totalPauseMs += entry.duration;

				// NODE_PERFORMANCE_GC_MAJOR is 4, not 2 (2 is a *flags* value, so comparing
				// against it never matches and reports every collection as minor).
				if (kind === constants.NODE_PERFORMANCE_GC_MAJOR) {
					this.majorCount++;
				} else if (kind === constants.NODE_PERFORMANCE_GC_MINOR) {
					this.minorCount++;
				}
			}
		});

		this.observer.observe({ entryTypes: ["gc"], buffered: false });
	}

	/**
	 * Returns the window's GC activity and resets the window accumulators.
	 */
	public collect(): GcMetrics {
		const metrics: GcMetrics = {
			pauseMs: Math.round(this.pauseMs * 1000) / 1000,
			count: this.count,
			majorCount: this.majorCount,
			minorCount: this.minorCount,
			totalPauseMs: Math.round(this.totalPauseMs * 1000) / 1000,
			totalCount: this.totalCount,
		};

		this.pauseMs = 0;
		this.count = 0;
		this.majorCount = 0;
		this.minorCount = 0;

		return metrics;
	}

	public destroy(): void {
		this.observer?.disconnect();
		this.observer = null;
	}
}
