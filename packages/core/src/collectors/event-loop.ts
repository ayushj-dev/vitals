import {
	type EventLoopUtilization,
	type IntervalHistogram,
	monitorEventLoopDelay,
	performance,
} from "node:perf_hooks";

const NS_PER_MS = 1e6;

export type EventLoopMetrics = {
	readonly minMs: number;
	readonly maxMs: number;
	readonly meanMs: number;
	readonly p95Ms: number;
	readonly p99Ms: number;
	/** Fraction of the window the loop was busy rather than idle, as a percentage (0-100). */
	readonly utilizationPercent: number;
};

/**
 * Tracks event loop delay and utilization over each sampling window.
 */
export class EventLoopCollector {
	private readonly histogram: IntervalHistogram;
	private readonly resolutionMs: number;
	private lastElu: EventLoopUtilization;

	constructor(resolutionMs = 10) {
		this.resolutionMs = resolutionMs;
		this.histogram = monitorEventLoopDelay({ resolution: resolutionMs });
		this.histogram.enable();
		this.lastElu = performance.eventLoopUtilization();
	}

	public collect(): EventLoopMetrics {
		// The histogram measures the whole timer interval, so an idle loop reads at the
		// resolution (~10ms) rather than 0. Subtract it so idle means idle.
		const metrics: EventLoopMetrics = {
			minMs: this.toDelayMs(this.histogram.min),
			maxMs: this.toDelayMs(this.histogram.max),
			meanMs: this.toDelayMs(this.histogram.mean),
			p95Ms: this.toDelayMs(this.histogram.percentile(95)),
			p99Ms: this.toDelayMs(this.histogram.percentile(99)),
			utilizationPercent: this.collectUtilization(),
		};

		this.histogram.reset();

		return metrics;
	}

	public destroy(): void {
		this.histogram.disable();
	}

	private collectUtilization(): number {
		// Passing the previous reading scopes the result to the window between the two.
		const elu = performance.eventLoopUtilization(this.lastElu);
		this.lastElu = performance.eventLoopUtilization();

		return Number.isFinite(elu.utilization) ? Math.round(elu.utilization * 10000) / 100 : 0;
	}

	private toDelayMs(nanoseconds: number | null | undefined): number {
		// An empty histogram reports null or MAX_SAFE_INTEGER sentinels.
		if (!nanoseconds || !Number.isFinite(nanoseconds) || nanoseconds < 0) {
			return 0;
		}

		const delayMs = nanoseconds / NS_PER_MS - this.resolutionMs;

		return delayMs > 0 ? Math.round(delayMs * 1000) / 1000 : 0;
	}
}
