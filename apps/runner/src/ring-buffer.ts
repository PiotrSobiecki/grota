export class RingBuffer<T> {
	private items: T[] = [];

	constructor(private readonly capacity: number) {
		if (capacity <= 0) {
			throw new Error("capacity must be > 0");
		}
	}

	push(item: T): void {
		this.items.push(item);
		if (this.items.length > this.capacity) {
			this.items.shift();
		}
	}

	snapshot(): T[] {
		return [...this.items];
	}

	get size(): number {
		return this.items.length;
	}
}
