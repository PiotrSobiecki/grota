import { describe, expect, it } from "vitest";
import { maskSecret } from "./mask";

describe("maskSecret", () => {
	it("masks the middle of a typical secret keeping prefix and suffix visible", () => {
		expect(maskSecret("K001abcdefghijklmnop")).toBe("K001****mnop");
	});

	it("fully masks a short secret without leaking any characters", () => {
		expect(maskSecret("abcd")).toBe("****");
	});

	it("returns empty string for empty input", () => {
		expect(maskSecret("")).toBe("");
	});

	it("masks a secret exactly at the reveal boundary", () => {
		// 8 chars (= 2 * 4 visible) — still too short to safely reveal both ends without overlap
		expect(maskSecret("abcdefgh")).toBe("****");
	});
});
