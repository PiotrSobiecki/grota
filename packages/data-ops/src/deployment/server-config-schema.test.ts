import { describe, expect, it } from "vitest";
import { validateBandwidthLimit } from "./server-config-schema";

describe("validateBandwidthLimit", () => {
	it("accepts a single time-rate slot", () => {
		expect(validateBandwidthLimit("08:00,5M")).toEqual({ ok: true });
	});

	it("accepts an empty string as no-limit", () => {
		expect(validateBandwidthLimit("")).toEqual({ ok: true });
	});

	it("rejects an obviously malformed string", () => {
		const result = validateBandwidthLimit("not-a-bandwidth");
		expect(result.ok).toBe(false);
	});

	it("accepts multiple space-separated slots", () => {
		expect(validateBandwidthLimit("08:00,5M 23:00,50M")).toEqual({ ok: true });
	});

	it("rejects an out-of-range hour", () => {
		const result = validateBandwidthLimit("25:00,5M");
		expect(result.ok).toBe(false);
	});

	it.each(["500K", "5M", "1G", "100B"])("accepts rate unit %s", (rate) => {
		expect(validateBandwidthLimit(`08:00,${rate}`)).toEqual({ ok: true });
	});

	it("rejects an unknown rate unit", () => {
		const result = validateBandwidthLimit("08:00,5X");
		expect(result.ok).toBe(false);
	});

	it("rejects an out-of-range minute", () => {
		const result = validateBandwidthLimit("08:99,5M");
		expect(result.ok).toBe(false);
	});

	it("returns a descriptive error message identifying the bad slot", () => {
		const result = validateBandwidthLimit("08:00,5M 25:00,1G");
		expect(result).toEqual({ ok: false, error: expect.stringContaining("25:00,1G") });
	});
});
