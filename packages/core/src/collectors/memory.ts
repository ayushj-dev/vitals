import os from "node:os";

/** Ticks between host memory reads. os.freemem() costs ~15us against a ~25us tick. */
const HOST_REFRESH_EVERY = 5;

export type MemoryMetrics = {
	readonly rssBytes: number;
	readonly heapUsedBytes: number;
	readonly heapTotalBytes: number;
	readonly externalBytes: number;
	readonly arrayBuffersBytes: number;
	/** Host memory free, refreshed every few samples rather than every one. */
	readonly hostFreeBytes: number;
	/** Share of host memory in use (0-100). */
	readonly hostUsedPercent: number;
};

/**
 * Reads process memory usage, plus a throttled view of host memory.
 *
 * Deliberately does not call v8.getHeapStatistics(): everything the dashboard charts is
 * already here, and mixing the two sources is what made "used heap" and "total heap"
 * come from different APIs. The one genuinely useful extra field, heap_size_limit,
 * never changes and lives in StaticInfoCollector instead.
 */
export class MemoryCollector {
	private readonly totalMemoryBytes = os.totalmem();
	private hostFreeBytes = os.freemem();
	private ticksSinceHostRead = 0;

	public collect(): MemoryMetrics {
		const memory = process.memoryUsage();

		// Host memory barely moves between samples and is the most expensive read here, so it
		// is refreshed periodically and cached in between.
		if (this.ticksSinceHostRead <= 0) {
			this.hostFreeBytes = os.freemem();
			this.ticksSinceHostRead = HOST_REFRESH_EVERY;
		}
		this.ticksSinceHostRead--;

		const used = this.totalMemoryBytes - this.hostFreeBytes;

		return {
			rssBytes: memory.rss,
			heapUsedBytes: memory.heapUsed,
			heapTotalBytes: memory.heapTotal,
			externalBytes: memory.external,
			arrayBuffersBytes: memory.arrayBuffers,
			hostFreeBytes: this.hostFreeBytes,
			hostUsedPercent:
				this.totalMemoryBytes > 0 ? Math.round((used / this.totalMemoryBytes) * 10000) / 100 : 0,
		};
	}
}
