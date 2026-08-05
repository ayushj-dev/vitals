import os from "node:os";

export type CpuMetrics = {
	/** Process CPU time spent in user code during the last sampling window. */
	readonly userDeltaUs: number;
	/** Process CPU time spent in kernel code during the last sampling window. */
	readonly systemDeltaUs: number;
	/** Process CPU usage over the window, normalized across all cores (0-100). */
	readonly cpuPercent: number;
	/** The user half of cpuPercent. */
	readonly userPercent: number;
	/** The kernel half of cpuPercent. */
	readonly systemPercent: number;
};

/**
 * Tracks process CPU usage as a delta over each sampling window.
 */
export class CpuCollector {
	private readonly coreCount: number;
	private lastUserUs: number;
	private lastSystemUs: number;
	private lastTimestampNs: bigint;

	constructor() {
		this.coreCount = os.cpus().length || 1;

		const usage = process.cpuUsage();
		this.lastUserUs = usage.user;
		this.lastSystemUs = usage.system;
		this.lastTimestampNs = process.hrtime.bigint();
	}

	public collect(): CpuMetrics {
		// One reading only: sampling cpuUsage twice makes the CPU delta and the elapsed-time
		// delta cover slightly different windows, which skews the percentage.
		const usage = process.cpuUsage();
		const timestampNs = process.hrtime.bigint();

		const userDeltaUs = usage.user - this.lastUserUs;
		const systemDeltaUs = usage.system - this.lastSystemUs;
		const elapsedUs = Number(timestampNs - this.lastTimestampNs) / 1000;

		this.lastUserUs = usage.user;
		this.lastSystemUs = usage.system;
		this.lastTimestampNs = timestampNs;

		const available = elapsedUs > 0 ? elapsedUs * this.coreCount : 0;
		const toPercent = (deltaUs: number) =>
			available > 0 ? Math.round(Math.min((deltaUs / available) * 100, 100) * 100) / 100 : 0;

		return {
			userDeltaUs,
			systemDeltaUs,
			cpuPercent: toPercent(userDeltaUs + systemDeltaUs),
			userPercent: toPercent(userDeltaUs),
			systemPercent: toPercent(systemDeltaUs),
		};
	}
}
