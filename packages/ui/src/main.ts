import { type ChartSeries, Panel } from "./charts";
import "./styles.css";

/* These are imported here so that vite bundles them */
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";

type StaticInfo = {
	hostname: string;
	platform: string;
	architecture: string;
	nodeVersion: string;
	cpuModel: string;
	cpuCores: number;
	totalMemoryBytes: number;
	heapSizeLimitBytes: number;
	pid: number;
	startedAt: number;
};

type RouteStats = {
	key: string;
	totalRequests: number;
	requests: number;
	clientErrorCount: number;
	serverErrorCount: number;
	avgLatencyMs: number;
	p95LatencyMs: number;
	p99LatencyMs: number;
	maxLatencyMs: number;
};

type Snapshot = {
	timestamp: number;
	cpu: { cpuPercent: number; userPercent: number; systemPercent: number };
	eventLoop: {
		minMs: number;
		maxMs: number;
		meanMs: number;
		p95Ms: number;
		p99Ms: number;
		utilizationPercent: number;
	};
	gc: {
		pauseMs: number;
		count: number;
		majorCount: number;
		minorCount: number;
		totalPauseMs: number;
		totalCount: number;
	} | null;
	memory: {
		rssBytes: number;
		heapUsedBytes: number;
		heapTotalBytes: number;
		externalBytes: number;
		arrayBuffersBytes: number;
		hostFreeBytes: number;
		hostUsedPercent: number;
	};
	http: {
		totalRequests: number;
		requestsPerSecond: number;
		inFlight: number;
		avgLatencyMs: number;
		p95LatencyMs: number;
		p99LatencyMs: number;
		maxLatencyMs: number;
		statusClasses: {
			informational: number;
			success: number;
			redirect: number;
			clientError: number;
			serverError: number;
		};
		statusCodes: Record<string, number>;
		routes: RouteStats[];
		trackedRoutes: number;
	};
};

type InitPayload = {
	staticInfo: StaticInfo;
	history: Record<string, number[]>;
	sampleIntervalMs: number;
};

const MB = 1024 * 1024;
const THEME_KEY = "vitals-theme";

const percent = (value: number) => `${value.toFixed(1)}%`;
const millis = (value: number) => `${value.toFixed(value < 10 ? 2 : 0)} ms`;
const megabytes = (value: number) => (value / MB).toFixed(0);
const rate = (value: number) => value.toFixed(value < 10 ? 1 : 0);
const count = (value: number) => value.toFixed(0);

const colors = {
	blue: "#2563eb",
	green: "#16a34a",
	violet: "#a855f7",
	amber: "#ca8a04",
	red: "#dc2626",
	slate: "#64748b",
};

/** Series carrying counts or percentages get integer ticks so idle does not repeat "1". */
const integerTicks = [1, 2, 5, 10, 20, 25, 50, 100];

type Definition = {
	title: string;
	format: (value: number) => string;
	incrs?: number[];
	series: ChartSeries[];
	/** Init-frame history series feeding each line, in the same order. */
	history: string[];
};

/**
 * Every chart, keyed by the suffix of its container id and of its expand button's
 * `data-expand`.
 */
const definitions = {
	cpu: {
		title: "CPU %",
		format: percent,
		incrs: integerTicks,
		series: [
			{ label: "total", color: colors.blue, fill: true },
			{ label: "user", color: colors.green },
			{ label: "system", color: colors.violet },
		],
		history: ["cpuPercent", "cpuUserPercent", "cpuSystemPercent"],
	},
	loop: {
		title: "Event Loop Delay (ms)",
		format: millis,
		series: [
			{ label: "mean", color: colors.blue, fill: true },
			{ label: "p95", color: colors.amber },
			{ label: "p99", color: colors.red },
		],
		history: ["eventLoopMeanMs", "eventLoopP95Ms", "eventLoopP99Ms"],
	},
	elu: {
		title: "Loop Utilization (%)",
		format: percent,
		incrs: integerTicks,
		series: [{ label: "busy", color: colors.violet, fill: true }],
		history: ["eventLoopUtilizationPercent"],
	},
	rss: {
		title: "Memory (MB)",
		format: megabytes,
		series: [
			{ label: "rss", color: colors.blue, fill: true },
			{ label: "heap used", color: colors.green },
		],
		history: ["rssBytes", "heapUsedBytes"],
	},
	heap: {
		title: "Heap (MB)",
		format: megabytes,
		series: [
			{ label: "used", color: colors.blue, fill: true },
			{ label: "total", color: colors.violet },
		],
		history: ["heapUsedBytes", "heapTotalBytes"],
	},
	external: {
		title: "External & Buffers (MB)",
		format: megabytes,
		series: [
			{ label: "external", color: colors.amber, fill: true },
			{ label: "array buffers", color: colors.slate },
		],
		history: ["externalBytes", "arrayBuffersBytes"],
	},
	rps: {
		title: "Requests / sec",
		format: rate,
		series: [{ label: "req/s", color: colors.green, fill: true }],
		history: ["requestsPerSecond"],
	},
	latency: {
		title: "Latency (ms)",
		format: millis,
		series: [
			{ label: "avg", color: colors.blue, fill: true },
			{ label: "p95", color: colors.amber },
			{ label: "p99", color: colors.red },
		],
		history: ["latencyAvgMs", "latencyP95Ms", "latencyP99Ms"],
	},
	status: {
		title: "Responses by Class",
		format: count,
		incrs: integerTicks,
		series: [
			{ label: "1xx", color: colors.slate },
			{ label: "2xx", color: colors.green, fill: true },
			{ label: "3xx", color: colors.blue },
			{ label: "4xx", color: colors.amber },
			{ label: "5xx", color: colors.red },
		],
		history: ["status1xx", "status2xx", "status3xx", "status4xx", "status5xx"],
	},
	inflight: {
		title: "In-flight Requests",
		format: count,
		incrs: integerTicks,
		series: [{ label: "in-flight", color: colors.violet, fill: true }],
		history: ["inFlight"],
	},
	gcPause: {
		title: "GC Pause (ms)",
		format: millis,
		series: [{ label: "pause", color: colors.red, fill: true }],
		history: ["gcPauseMs"],
	},
	gcCount: {
		title: "GC Collections",
		format: count,
		incrs: integerTicks,
		series: [
			{ label: "minor", color: colors.blue, fill: true },
			{ label: "major", color: colors.red },
		],
		history: ["gcMinorCount", "gcMajorCount"],
	},
} satisfies Record<string, Definition>;

type ChartKey = keyof typeof definitions;

/** Same object, widened so that the optional `incrs` is reachable for any key. */
const defs: Record<ChartKey, Definition> = definitions;

// Resolved once: repeating getElementById on every frame is wasted work.
const el = {
	statusDot: byId("status-dot"),
	statusText: byId("status-text"),
	metaUptime: byId("meta-uptime"),
	routes: byId("routes"),
	statusCodes: byId("status-codes"),
	modal: byId("chart-modal") as HTMLDialogElement,
	modalTitle: byId("modal-title"),
	modalChart: byId("modal-chart"),
	envUptime: byId("env-uptime"),
};

/** Card value and sub-label elements, keyed by the card id used in the markup. */
const cards = new Map<string, { value: HTMLElement; sub: HTMLElement }>();
for (const value of document.querySelectorAll<HTMLElement>("[id^='card-']")) {
	const id = value.id.slice("card-".length);
	const sub = document.getElementById(`sub-${id}`);
	if (sub) cards.set(id, { value, sub });
}

const panels = new Map<ChartKey, Panel>();
let startedAt = 0;
let frameRequested = false;
let modalKey: ChartKey | null = null;

function buildPanels(capacity: number): void {
	for (const key of Object.keys(defs) as ChartKey[]) {
		const { series, format, incrs } = defs[key];
		const panel = new Panel({ series, format, incrs, capacity });

		panel.attach(byId(`chart-${key}`));
		panels.set(key, panel);
	}
}

function onInit(payload: InitPayload): void {
	const history = payload.history ?? {};
	const timestamps = history.timestamps ?? [];
	const intervalMs = payload.sampleIntervalMs || 1000;

	startedAt = payload.staticInfo?.startedAt ?? Date.now();

	if (panels.size === 0) {
		buildPanels(Math.max(timestamps.length, 60));
	}

	for (const [key, panel] of panels) {
		panel.seed(
			timestamps,
			defs[key].history.map((series) => history[series] ?? []),
		);
	}

	renderEnvironment(payload.staticInfo, intervalMs);
	scheduleFlush();
}

function onSnapshot(snapshot: Snapshot): void {
	if (panels.size === 0) return;

	const { timestamp, cpu, eventLoop, memory, http, gc } = snapshot;
	const status = http.statusClasses;
	const gcPause = gc?.pauseMs ?? 0;

	push("cpu", timestamp, [cpu.cpuPercent, cpu.userPercent, cpu.systemPercent]);
	push("loop", timestamp, [eventLoop.meanMs, eventLoop.p95Ms, eventLoop.p99Ms]);
	push("elu", timestamp, [eventLoop.utilizationPercent]);
	push("rss", timestamp, [memory.rssBytes, memory.heapUsedBytes]);
	push("heap", timestamp, [memory.heapUsedBytes, memory.heapTotalBytes]);
	push("external", timestamp, [memory.externalBytes, memory.arrayBuffersBytes]);
	push("rps", timestamp, [http.requestsPerSecond]);
	push("latency", timestamp, [http.avgLatencyMs, http.p95LatencyMs, http.p99LatencyMs]);
	push("status", timestamp, [
		status.informational,
		status.success,
		status.redirect,
		status.clientError,
		status.serverError,
	]);
	push("inflight", timestamp, [http.inFlight]);
	push("gcPause", timestamp, [gcPause]);
	push("gcCount", timestamp, [gc?.minorCount ?? 0, gc?.majorCount ?? 0]);

	setCard(
		"cpu",
		percent(cpu.cpuPercent),
		`${percent(cpu.userPercent)} user · ${percent(cpu.systemPercent)} system`,
	);
	setCard(
		"rss",
		`${megabytes(memory.rssBytes)} MB`,
		`${percent(memory.hostUsedPercent)} of host in use`,
	);
	setCard(
		"heap",
		`${megabytes(memory.heapUsedBytes)} MB`,
		`of ${megabytes(memory.heapTotalBytes)} MB allocated`,
	);
	setCard("loop-avg", millis(eventLoop.meanMs), `${millis(eventLoop.minMs)} min`);
	setCard("loop-p95", millis(eventLoop.p95Ms), "");
	setCard("loop-p99", millis(eventLoop.p99Ms), `${millis(eventLoop.maxMs)} max`);
	setCard("elu", percent(eventLoop.utilizationPercent), "of the sampling window");
	setCard(
		"gc",
		millis(gcPause),
		gc
			? `${gc.count}/s · ${gc.totalCount} total · ${millis(gc.totalPauseMs)} paused`
			: "tracking disabled",
	);

	setCard("rps", rate(http.requestsPerSecond), `${http.totalRequests} total`);
	setCard("lat-avg", millis(http.avgLatencyMs), `${millis(http.maxLatencyMs)} max`);
	setCard("lat-p95", millis(http.p95LatencyMs), "");
	setCard("lat-p99", millis(http.p99LatencyMs), "");
	setCard("inflight", count(http.inFlight), `${status.informational} informational`);
	setCard(
		"errors",
		count(status.clientError + status.serverError),
		`${status.clientError} client · ${status.serverError} server`,
	);
	setCard(
		"routes",
		count(http.trackedRoutes),
		`${status.success + status.redirect} ok this second`,
	);

	const up = uptime(Date.now() - startedAt);
	el.metaUptime.textContent = `up: ${up}`;
	el.envUptime.textContent = up;

	renderRoutes(http.routes);
	renderStatusCodes(http.statusCodes);
	scheduleFlush();
}

function push(key: ChartKey, timestamp: number, values: number[]): void {
	panels.get(key)?.push(timestamp, values);
}

function setCard(id: string, value: string, sub: string): void {
	const card = cards.get(id);
	if (!card) return;

	// textContent rather than innerText: innerText forces a synchronous layout on every write.
	card.value.textContent = value;
	card.sub.textContent = sub;
}

function renderRoutes(routes: readonly RouteStats[]): void {
	if (!routes || routes.length === 0) return;

	el.routes.innerHTML = routes
		.map((route) => {
			const space = route.key.indexOf(" ");
			const method = space > 0 ? route.key.slice(0, space) : "";
			const path = space > 0 ? route.key.slice(space + 1) : route.key;

			return `<tr><td>${escapeHtml(method)}</td><td>${escapeHtml(path)}</td><td class="num">${route.totalRequests}</td><td class="num">${rate(route.requests)}</td><td class="num">${route.avgLatencyMs.toFixed(1)}</td><td class="num">${route.p95LatencyMs.toFixed(1)}</td><td class="num">${route.p99LatencyMs.toFixed(1)}</td><td class="num">${route.maxLatencyMs.toFixed(1)}</td><td class="num${route.clientErrorCount > 0 ? " text-warn" : ""}">${route.clientErrorCount}</td><td class="num${route.serverErrorCount > 0 ? " text-bad" : ""}">${route.serverErrorCount}</td></tr>`;
		})
		.join("");
}

function renderStatusCodes(codes: Record<string, number>): void {
	const entries = Object.entries(codes ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
	if (entries.length === 0) return;

	el.statusCodes.innerHTML = entries
		.map(([code, total]) => `<tr><td>${Number(code)}</td><td class="num">${total}</td></tr>`)
		.join("");
}

function renderEnvironment(info: StaticInfo | undefined, intervalMs: number): void {
	byId("env-interval").textContent = `${intervalMs / 1000}s`;
	if (!info) return;

	byId("env-host").textContent = info.hostname;
	byId("env-node").textContent = info.nodeVersion;
	byId("env-platform").textContent = `${info.platform} / ${info.architecture}`;
	byId("env-cpu").textContent = info.cpuModel;
	byId("env-cpu").title = info.cpuModel;
	byId("env-cores").textContent = String(info.cpuCores);
	byId("env-memory").textContent = `${(info.totalMemoryBytes / MB / 1024).toFixed(1)} GB`;
	byId("env-heaplimit").textContent = `${megabytes(info.heapSizeLimitBytes)} MB`;
	byId("env-pid").textContent = String(info.pid);
}

/**
 * Coalesces repaints into one animation frame. Browsers throttle rAF in hidden tabs, so a
 * background dashboard stops painting without any extra bookkeeping.
 */
function scheduleFlush(): void {
	if (frameRequested) return;

	frameRequested = true;
	requestAnimationFrame(() => {
		frameRequested = false;
		for (const panel of panels.values()) panel.flush();
	});
}

function connect(): void {
	// Relative to the current path, so the dashboard works under any mount prefix.
	const base = location.pathname.replace(/\/$/, "");
	const source = new EventSource(`${base}/events`);

	source.addEventListener("open", () => setStatus("live", "live"));
	source.addEventListener("error", () => setStatus("down", "reconnecting…"));

	source.addEventListener("init", (event) => {
		// One malformed frame must not take the stream down with it.
		try {
			onInit(JSON.parse((event as MessageEvent<string>).data));
		} catch {
			setStatus("down", "bad init frame");
		}
	});

	source.addEventListener("message", (event) => {
		try {
			onSnapshot(JSON.parse((event as MessageEvent<string>).data));
		} catch {
			/* skip this sample */
		}
	});
}

function setStatus(state: "live" | "down" | "connecting", text: string): void {
	el.statusDot.dataset.state = state;
	el.statusText.textContent = text;
}

function initModal(): void {
	for (const button of document.querySelectorAll<HTMLElement>("[data-expand]")) {
		button.addEventListener("click", () => openModal(button.dataset.expand as ChartKey));
	}

	byId("modal-close").addEventListener("click", () => el.modal.close());
	// A click landing on the dialog itself is a click on the backdrop.
	el.modal.addEventListener("click", (event) => {
		if (event.target === el.modal) el.modal.close();
	});
	el.modal.addEventListener("close", () => {
		if (modalKey) panels.get(modalKey)?.detach(el.modalChart);
		modalKey = null;
	});
}

function openModal(key: ChartKey): void {
	const panel = panels.get(key);
	if (!panel) return;

	modalKey = key;
	el.modalTitle.textContent = defs[key].title;
	el.modal.showModal();
	// Attach only once the browser has sized the dialog, or uPlot measures zero.
	requestAnimationFrame(() => {
		panel.attach(el.modalChart);
		panel.flush();
	});
}

function initTheme(): void {
	byId("theme-toggle").addEventListener("click", () => {
		const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";

		document.documentElement.dataset.theme = next;
		localStorage.setItem(THEME_KEY, next);

		// uPlot bakes axis and grid colours into its canvas at build time, so the instances
		// have to be rebuilt. This is a click, not a frame, so the cost does not matter.
		for (const panel of panels.values()) panel.restyle();
	});
}

function uptime(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;

	return `${seconds}s`;
}

function byId(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (!element) throw new Error(`Missing element #${id}`);

	return element;
}

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
	);
}

initTheme();
initModal();
connect();
