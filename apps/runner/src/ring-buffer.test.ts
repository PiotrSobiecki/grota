import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ring-buffer";

describe("RingBuffer", () => {
	it("returns inserted items in order when below capacity", () => {
		const buf = new RingBuffer<number>(5);
		buf.push(1);
		buf.push(2);
		buf.push(3);
		expect(buf.snapshot()).toEqual([1, 2, 3]);
	});

	it("evicts oldest items when capacity is exceeded (FIFO)", () => {
		const buf = new RingBuffer<number>(3);
		buf.push(1);
		buf.push(2);
		buf.push(3);
		buf.push(4);
		buf.push(5);
		expect(buf.snapshot()).toEqual([3, 4, 5]);
	});

	it("size reflects current item count, capped at capacity", () => {
		const buf = new RingBuffer<number>(2);
		expect(buf.size).toBe(0);
		buf.push(1);
		expect(buf.size).toBe(1);
		buf.push(2);
		buf.push(3);
		expect(buf.size).toBe(2);
	});
});
