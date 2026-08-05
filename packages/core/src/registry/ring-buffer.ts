/**
 * Fixed-capacity circular buffer of numbers backed by a Float64Array.
 * Writes are O(1) and allocation-free; only reads allocate.
 */
export class RingBuffer {
	private readonly buffer: Float64Array;
	private readonly capacity: number;
	private pointer = 0;
	private isFull = false;

	constructor(capacity: number) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			// A zero capacity makes `% capacity` produce NaN and silently corrupts every write.
			throw new RangeError(`RingBuffer capacity must be a positive integer, got ${capacity}`);
		}

		this.capacity = capacity;
		this.buffer = new Float64Array(capacity);
	}

	/**
	 * Appends a value, overwriting the oldest entry once full.
	 */
	public push(value: number): void {
		this.buffer[this.pointer] = value;
		this.pointer = (this.pointer + 1) % this.capacity;

		if (this.pointer === 0) {
			this.isFull = true;
		}
	}

	/**
	 * Returns the stored values oldest-first as a plain array.
	 *
	 * Plain array rather than Float64Array because every caller serializes this to JSON,
	 * and `JSON.stringify(new Float64Array([1,2]))` yields `{"0":1,"1":2}` rather than `[1,2]`.
	 */
	public toArray(): number[] {
		const size = this.isFull ? this.capacity : this.pointer;
		const result: number[] = new Array(size);

		for (let i = 0; i < size; i++) {
			const index = this.isFull ? (this.pointer + i) % this.capacity : i;
			result[i] = this.buffer[index] as number;
		}

		return result;
	}

	/**
	 * Number of values currently stored.
	 */
	public get size(): number {
		return this.isFull ? this.capacity : this.pointer;
	}

	/**
	 * Clears the buffer without reallocating.
	 */
	public reset(): void {
		this.pointer = 0;
		this.isFull = false;
		this.buffer.fill(0);
	}
}
