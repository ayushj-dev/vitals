import { SSEBroadcaster, type SSEBroadcasterOptions } from "../broadcaster/sse-broadcaster";
import { CpuCollector, type CpuMetrics } from "../collectors/cpu";
import { EventLoopCollector, type EventLoopMetrics } from "../collectors/event-loop";
import { GcCollector, type GcMetrics } from "../collectors/gc";
import {
	HttpCollector,
	type HttpCollectorOptions,
	type HttpMetrics,
	type HttpRequestMetric,
} from "../collectors/http";
import { MemoryCollector, type MemoryMetrics } from "../collectors/memory";
import { StaticInfoCollector, type StaticSystemInfo } from "../collectors/static-info";
import { RingBuffer } from "../registry/ring-buffer";

export type VitalsEngineOptions = {
	/** Sampling interval in milliseconds. @default 1000 */
	sampleIntervalMs?: number;
	/** Samples of history retained per series. @default 60 */
	historySize?: number;
	/**
	 * Track V8 garbage collection. The observer allocates an entry per collection, making it
	 * the only part of the engine whose cost scales with application behaviour.
	 * @default true
	 */
	enableGcTracking?: boolean;
	/** Event loop delay histogram resolution in milliseconds. @default 10 */
	eventLoopResolutionMs?: number;
	http?: HttpCollectorOptions;
	sse?: SSEBroadcasterOptions;
};

export type MetricSnapshot = {
	readonly timestamp: number;
	readonly cpu: CpuMetrics;
	readonly eventLoop: EventLoopMetrics;
	readonly gc: GcMetrics | null;
	readonly memory: MemoryMetrics;
	readonly http: HttpMetrics;
};

/**
 * Every charted series is retained so that no panel is blank after a reload. At the default
 * 60 samples that is roughly 13kB of buffers.
 */
const HISTORY_KEYS = [
	"timestamps",
	"cpuPercent",
	"cpuUserPercent",
	"cpuSystemPercent",
	"eventLoopMeanMs",
	"eventLoopP95Ms",
	"eventLoopP99Ms",
	"eventLoopUtilizationPercent",
	"rssBytes",
	"heapUsedBytes",
	"heapTotalBytes",
	"externalBytes",
	"arrayBuffersBytes",
	"gcPauseMs",
	"gcMajorCount",
	"gcMinorCount",
	"requestsPerSecond",
	"latencyAvgMs",
	"latencyP95Ms",
	"latencyP99Ms",
	"inFlight",
	"status1xx",
	"status2xx",
	"status3xx",
	"status4xx",
	"status5xx",
] as const;

type HistoryKey = (typeof HISTORY_KEYS)[number];

/** Series retained for chart backfill. Plain arrays so they survive JSON serialization. */
export type MetricHistory = { readonly [K in HistoryKey]: number[] };

/** First frame a dashboard receives: everything needed to draw before the next tick. */
export type VitalsInitPayload = {
	readonly staticInfo: StaticSystemInfo;
	readonly history: MetricHistory;
	readonly sampleIntervalMs: number;
};

/**
 * Samples process health on a fixed interval, retains a short window of history, and
 * streams each sample to connected dashboards.
 */
export class VitalsEngine {
	private readonly options: Required<Omit<VitalsEngineOptions, "http" | "sse">>;
	private readonly staticInfo: StaticSystemInfo;

	private readonly cpuCollector = new CpuCollector();
	private readonly memoryCollector = new MemoryCollector();
	private readonly httpCollector: HttpCollector;
	private eventLoopCollector: EventLoopCollector | null = null;
	private gcCollector: GcCollector | null = null;

	private readonly buffers: Record<HistoryKey, RingBuffer>;

	private latestSnapshot: MetricSnapshot | null = null;
	private timer: NodeJS.Timeout | null = null;
	private running = false;

	public readonly broadcaster: SSEBroadcaster;

	constructor(options: VitalsEngineOptions = {}) {
		this.options = {
			sampleIntervalMs: options.sampleIntervalMs ?? 1000,
			historySize: options.historySize ?? 60,
			enableGcTracking: options.enableGcTracking ?? true,
			eventLoopResolutionMs: options.eventLoopResolutionMs ?? 10,
		};

		this.staticInfo = new StaticInfoCollector().collect();
		this.httpCollector = new HttpCollector(options.http);

		const capacity = this.options.historySize;
		this.buffers = {} as Record<HistoryKey, RingBuffer>;
		for (const key of HISTORY_KEYS) {
			this.buffers[key] = new RingBuffer(capacity);
		}

		this.broadcaster = new SSEBroadcaster(() => this.getInitPayload(), options.sse);
	}

	/**
	 * Marks an HTTP request as started, for the in-flight count. Must be paired with
	 * `recordRequest`, including when the client aborts.
	 */
	public startRequest(): void {
		this.httpCollector.startRequest();
	}

	/**
	 * Records a completed HTTP request. Called by framework adaptors on every request.
	 */
	public recordRequest(metric: HttpRequestMetric): void {
		this.httpCollector.record(metric);
	}

	public start(): this {
		if (this.running) return this;

		this.running = true;

		// Recreated on every start so that stop() can release them and start() still works.
		this.eventLoopCollector = new EventLoopCollector(this.options.eventLoopResolutionMs);
		if (this.options.enableGcTracking) {
			this.gcCollector = new GcCollector();
		}

		this.timer = setInterval(() => this.tick(), this.options.sampleIntervalMs);
		this.timer.unref();

		return this;
	}

	public stop(): this {
		if (!this.running) return this;

		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}

		this.eventLoopCollector?.destroy();
		this.eventLoopCollector = null;
		this.gcCollector?.destroy();
		this.gcCollector = null;
		this.broadcaster.destroy();

		this.running = false;

		return this;
	}

	public get isRunning(): boolean {
		return this.running;
	}

	/** Latest sample, or null before the first tick. */
	public getSnapshot(): MetricSnapshot | null {
		return this.latestSnapshot;
	}

	public getHistory(): MetricHistory {
		const history = {} as Record<HistoryKey, number[]>;
		for (const key of HISTORY_KEYS) {
			history[key] = this.buffers[key].toArray();
		}

		return history;
	}

	public getStaticInfo(): StaticSystemInfo {
		return this.staticInfo;
	}

	public getInitPayload(): VitalsInitPayload {
		return {
			staticInfo: this.staticInfo,
			history: this.getHistory(),
			sampleIntervalMs: this.options.sampleIntervalMs,
		};
	}

	private tick(): void {
		// A throw here would surface as an uncaught exception from a timer callback and take
		// down the host application. Monitoring must never do that.
		try {
			const timestamp = Date.now();
			const cpu = this.cpuCollector.collect();
			const eventLoop = this.eventLoopCollector?.collect() ?? EMPTY_EVENT_LOOP;
			const gc = this.gcCollector?.collect() ?? null;
			const memory = this.memoryCollector.collect();
			const http = this.httpCollector.collect();

			this.buffers.timestamps.push(timestamp);
			this.buffers.cpuPercent.push(cpu.cpuPercent);
			this.buffers.cpuUserPercent.push(cpu.userPercent);
			this.buffers.cpuSystemPercent.push(cpu.systemPercent);
			this.buffers.eventLoopMeanMs.push(eventLoop.meanMs);
			this.buffers.eventLoopP95Ms.push(eventLoop.p95Ms);
			this.buffers.eventLoopP99Ms.push(eventLoop.p99Ms);
			this.buffers.eventLoopUtilizationPercent.push(eventLoop.utilizationPercent);
			this.buffers.rssBytes.push(memory.rssBytes);
			this.buffers.heapUsedBytes.push(memory.heapUsedBytes);
			this.buffers.heapTotalBytes.push(memory.heapTotalBytes);
			this.buffers.externalBytes.push(memory.externalBytes);
			this.buffers.arrayBuffersBytes.push(memory.arrayBuffersBytes);
			// Window figures, not lifetime totals, which would only ever ramp up.
			this.buffers.gcPauseMs.push(gc?.pauseMs ?? 0);
			this.buffers.gcMajorCount.push(gc?.majorCount ?? 0);
			this.buffers.gcMinorCount.push(gc?.minorCount ?? 0);
			this.buffers.requestsPerSecond.push(http.requestsPerSecond);
			this.buffers.latencyAvgMs.push(http.avgLatencyMs);
			this.buffers.latencyP95Ms.push(http.p95LatencyMs);
			this.buffers.latencyP99Ms.push(http.p99LatencyMs);
			this.buffers.inFlight.push(http.inFlight);
			this.buffers.status1xx.push(http.statusClasses.informational);
			this.buffers.status2xx.push(http.statusClasses.success);
			this.buffers.status3xx.push(http.statusClasses.redirect);
			this.buffers.status4xx.push(http.statusClasses.clientError);
			this.buffers.status5xx.push(http.statusClasses.serverError);

			this.latestSnapshot = { timestamp, cpu, eventLoop, gc, memory, http };
			this.broadcaster.broadcast(this.latestSnapshot);
		} catch {
			// Dropping a sample is always preferable to crashing the host process.
		}
	}
}

const EMPTY_EVENT_LOOP: EventLoopMetrics = {
	minMs: 0,
	maxMs: 0,
	meanMs: 0,
	p95Ms: 0,
	p99Ms: 0,
	utilizationPercent: 0,
};
