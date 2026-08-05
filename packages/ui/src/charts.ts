import uPlot from "uplot";

/**
 * Fixed-capacity series backed by a Float64Array.
 *
 * Samples fill from the left and only shift once the buffer is full, so a chart drawn from a
 * short history spans the plot immediately rather than creeping in from the right edge over
 * a minute. Once full, appending is a `copyWithin` plus one write: no allocation, no
 * `shift()`, and uPlot keeps receiving the same view every frame.
 */
class Series {
	public readonly values: Float64Array;

	constructor(private readonly capacity: number) {
		this.values = new Float64Array(capacity).fill(Number.NaN);
	}

	public write(index: number, value: number): void {
		this.values[index] = value;
	}

	public shiftIn(value: number): void {
		this.values.copyWithin(0, 1);
		this.values[this.capacity - 1] = value;
	}
}

export type ChartSeries = {
	label: string;
	color: string;
	/** Draw a translucent area beneath the line. */
	fill?: boolean;
};

export type PanelOptions = {
	series: readonly ChartSeries[];
	/** Samples retained. Older ones shift out once it is reached. */
	capacity: number;
	/** Formats y axis ticks, legend values and cursor readouts. */
	format: (value: number) => string;
	/** Tick increments. Used to force integer ticks on percentage and count axes. */
	incrs?: number[];
};

type Attachment = {
	element: HTMLElement;
	plot: uPlot;
	observer: ResizeObserver;
};

/**
 * One metric group and every plot currently drawing it.
 *
 * Plots share the panel's Float64Array views, so opening the modal costs a second uPlot
 * instance rather than a second copy of the data, and both stay in step from one `flush`.
 */
export class Panel {
	private readonly time: Series;
	private readonly series: Series[];
	private readonly attachments: Attachment[] = [];
	private data: uPlot.AlignedData;
	private filled = 0;
	private dirty = true;

	constructor(private readonly options: PanelOptions) {
		this.time = new Series(options.capacity);
		this.series = options.series.map(() => new Series(options.capacity));
		this.data = this.view();
	}

	public attach(element: HTMLElement): void {
		const { format, incrs } = this.options;
		const palette = readPalette();
		const axis = {
			stroke: palette.axis,
			grid: { stroke: palette.grid, width: 1 },
			ticks: { stroke: palette.grid, width: 1 },
		};
		const size = innerSize(element);
		// Rough reservation for the initial draw; corrected below once the legend is laid out.
		const legendHeight = this.options.series.length > 1 ? 36 : 20;

		const plot = new uPlot(
			{
				width: size.width || 400,
				height: Math.max(60, (size.height || 260) - legendHeight),
				padding: [8, 12, 4, 4],
				legend: { show: true, live: true },
				cursor: { drag: { x: false, y: false }, points: { size: 5 } },
				scales: { x: { time: true } },
				axes: [
					{ ...axis, font: palette.font },
					{
						...axis,
						font: palette.font,
						size: 48,
						incrs,
						// Blank consecutive duplicates: a rounding formatter would otherwise
						// repeat "1%" across several splits while the metric sits near idle.
						values: (_u, splits) => {
							const labels = splits.map(format);

							return labels.map((label, i) => (i > 0 && label === labels[i - 1] ? "" : label));
						},
					},
				],
				series: [
					// uPlot's default time legend stamp omits seconds; samples are 1Hz so that matters.
					{ value: "{h}:{mm}:{ss}{aa}" },
					...this.options.series.map((definition) => ({
						label: definition.label,
						stroke: definition.color,
						fill: withAlpha(definition.color),
						width: 1.5,
						points: { show: false },
						value: (_u: uPlot, value: number | null) => (value == null ? "–" : format(value)),
					})),
				],
			},
			this.data,
			element,
		);

		const resize = () => {
			const { width, height } = innerSize(element);
			if (width <= 0 || height <= 0) return;

			const legend = element.querySelector<HTMLElement>(".u-legend")?.offsetHeight ?? legendHeight;
			plot.setSize({ width, height: Math.max(60, height - legend) });
		};

		const observer = new ResizeObserver(resize);
		observer.observe(element);
		// Replace the legend estimate once the browser has laid the legend out.
		requestAnimationFrame(resize);

		this.attachments.push({ element, plot, observer });
	}

	public detach(element: HTMLElement): void {
		const index = this.attachments.findIndex((a) => a.element === element);
		const attachment = this.attachments[index];
		if (!attachment) return;

		attachment.observer.disconnect();
		attachment.plot.destroy();
		this.attachments.splice(index, 1);
		element.replaceChildren();
	}

	/** Recreates every plot so axis and grid colours re-read the theme's CSS variables. */
	public restyle(): void {
		const elements = this.attachments.map((a) => a.element);

		for (const element of elements) this.detach(element);
		for (const element of elements) this.attach(element);
	}

	/** Appends one sample. Values must align with the series definitions. */
	public push(timestampMs: number, values: readonly number[]): void {
		if (this.filled < this.options.capacity) {
			const index = this.filled;

			this.time.write(index, timestampMs / 1000);
			for (let i = 0; i < this.series.length; i++) {
				this.series[i]?.write(index, values[i] ?? Number.NaN);
			}

			this.filled++;
			// Views only change while the window is filling; after that the array is reused.
			this.data = this.view();
		} else {
			this.time.shiftIn(timestampMs / 1000);
			for (let i = 0; i < this.series.length; i++) {
				this.series[i]?.shiftIn(values[i] ?? Number.NaN);
			}
		}

		this.dirty = true;
	}

	/** Backfills history from the init frame. Timestamps are in milliseconds. */
	public seed(timestampsMs: readonly number[], values: readonly (readonly number[])[]): void {
		const count = Math.min(timestampsMs.length, this.options.capacity);

		for (let index = 0; index < count; index++) {
			this.time.write(index, (timestampsMs[index] as number) / 1000);

			for (let i = 0; i < this.series.length; i++) {
				this.series[i]?.write(index, values[i]?.[index] ?? Number.NaN);
			}
		}

		this.filled = count;
		this.data = this.view();
		this.dirty = true;
	}

	/**
	 * Only the samples written so far, so a partly filled window plots across the full width
	 * instead of leaving most of the chart blank.
	 */
	private view(): uPlot.AlignedData {
		if (this.filled >= this.options.capacity) {
			return [this.time.values, ...this.series.map((s) => s.values)];
		}

		return [
			this.time.values.subarray(0, this.filled),
			...this.series.map((s) => s.values.subarray(0, this.filled)),
		];
	}

	/** Repaints if there is new data. Called from a single shared animation frame. */
	public flush(): void {
		if (!this.dirty) return;

		this.dirty = false;
		// resetScales so the y axis follows the rolling window rather than its all-time range.
		for (const { plot } of this.attachments) plot.setData(this.data, true);
	}
}

/** Palette comes from the theme's CSS variables, so a toggle needs no JS colour table. */
function readPalette() {
	const style = getComputedStyle(document.documentElement);
	const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;

	return {
		axis: read("--color-muted", "#6b7280"),
		grid: read("--color-grid", "rgba(0,0,0,0.14)"),
		font: `11px ${read("--font-mono", "monospace")}`,
	};
}

/** clientWidth/Height include padding, which uPlot must not draw into. */
function innerSize(element: HTMLElement) {
	const style = getComputedStyle(element);
	const horizontal = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
	const vertical = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

	return {
		width: Math.max(0, element.clientWidth - horizontal),
		height: Math.max(0, element.clientHeight - vertical),
	};
}

function withAlpha(color: string): string {
	return `${color}10`;
}
