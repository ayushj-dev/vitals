import os from "node:os";
import v8 from "node:v8";

export type StaticSystemInfo = {
	readonly hostname: string;
	readonly platform: NodeJS.Platform;
	readonly architecture: string;
	readonly nodeVersion: string;
	readonly cpuModel: string;
	readonly cpuCores: number;
	readonly totalMemoryBytes: number;
	readonly heapSizeLimitBytes: number;
	readonly pid: number;
	readonly startedAt: number;
};

/**
 * Collects host and runtime facts that cannot change while the process is alive.
 */
export class StaticInfoCollector {
	private readonly info: StaticSystemInfo;

	constructor() {
		const cpus = os.cpus();

		this.info = Object.freeze({
			hostname: os.hostname(),
			platform: process.platform,
			architecture: process.arch,
			nodeVersion: process.version,
			cpuModel: cpus[0]?.model ?? "unknown",
			cpuCores: cpus.length || 1,
			totalMemoryBytes: os.totalmem(),
			heapSizeLimitBytes: v8.getHeapStatistics().heap_size_limit,
			pid: process.pid,
			startedAt: Date.now(),
		});
	}

	public collect(): StaticSystemInfo {
		return this.info;
	}
}
