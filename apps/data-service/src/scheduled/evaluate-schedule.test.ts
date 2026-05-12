import { describe, expect, it } from "vitest";
import { evaluateSchedule, type Schedule } from "./evaluate-schedule";

const baseSchedule: Omit<Schedule, "enabled" | "intervalHours" | "lastRunAt" | "nextRunAt"> = {
	anchorTime: "02:00",
	anchorTimezone: "Europe/Warsaw",
};

describe("evaluateSchedule", () => {
	it("returns shouldRun=false when schedule is disabled, even if due", () => {
		const now = new Date("2026-05-11T12:00:00Z");
		const pastNextRun = new Date("2026-05-11T10:00:00Z");

		const decision = evaluateSchedule(now, {
			...baseSchedule,
			enabled: false,
			intervalHours: 24,
			lastRunAt: null,
			nextRunAt: pastNextRun,
		});

		expect(decision.shouldRun).toBe(false);
		expect(decision.nextRunAt).toEqual(pastNextRun);
	});

	it("returns shouldRun=false when enabled but nextRunAt is in the future", () => {
		const now = new Date("2026-05-11T12:00:00Z");
		const futureNextRun = new Date("2026-05-11T20:00:00Z");

		const decision = evaluateSchedule(now, {
			...baseSchedule,
			enabled: true,
			intervalHours: 24,
			lastRunAt: null,
			nextRunAt: futureNextRun,
		});

		expect(decision.shouldRun).toBe(false);
		expect(decision.nextRunAt).toEqual(futureNextRun);
	});

	it("when due with interval 24h, anchors nextRunAt to the next anchor_time slot in Europe/Warsaw", () => {
		// 2026-05-11 12:00 UTC = 14:00 CEST (Europe/Warsaw, summer +2)
		// Anchor 02:00 Europe/Warsaw → next slot = 2026-05-12 02:00 CEST = 2026-05-12 00:00 UTC
		const now = new Date("2026-05-11T12:00:00Z");
		const pastNextRun = new Date("2026-05-11T10:00:00Z");

		const decision = evaluateSchedule(now, {
			...baseSchedule,
			enabled: true,
			intervalHours: 24,
			lastRunAt: null,
			nextRunAt: pastNextRun,
		});

		expect(decision.shouldRun).toBe(true);
		expect(decision.nextRunAt).toEqual(new Date("2026-05-12T00:00:00Z"));
	});

	it("when due with interval 6h and anchor 02:00, snaps nextRunAt to the next grid slot in Europe/Warsaw", () => {
		// Slots in Europe/Warsaw (summer +2): 02:00, 08:00, 14:00, 20:00
		// now = 2026-05-11 12:00 UTC = 14:00 CEST → next slot = 20:00 CEST = 18:00 UTC
		const now = new Date("2026-05-11T12:00:00Z");

		const decision = evaluateSchedule(now, {
			...baseSchedule,
			enabled: true,
			intervalHours: 6,
			lastRunAt: null,
			nextRunAt: new Date("2026-05-11T10:00:00Z"),
		});

		expect(decision.shouldRun).toBe(true);
		expect(decision.nextRunAt).toEqual(new Date("2026-05-11T18:00:00Z"));
	});

	it("when bootstrapping (nextRunAt is null), runs immediately and schedules next at the anchor slot", () => {
		// Same time math as previous test: next anchor slot is tomorrow 02:00 CEST = 00:00 UTC
		const now = new Date("2026-05-11T12:00:00Z");

		const decision = evaluateSchedule(now, {
			...baseSchedule,
			enabled: true,
			intervalHours: 24,
			lastRunAt: null,
			nextRunAt: null,
		});

		expect(decision.shouldRun).toBe(true);
		expect(decision.nextRunAt).toEqual(new Date("2026-05-12T00:00:00Z"));
	});

	it("DST spring forward: anchor 02:00 on 2026-03-29 (gap) falls forward to 03:00 CEST = 01:00 UTC", () => {
		// Poland DST spring forward 2026: 2026-03-29 02:00 CET → 03:00 CEST (02:00 does not exist)
		// now = 2026-03-28 12:00 UTC (= 13:00 CET, day before transition)
		const now = new Date("2026-03-28T12:00:00Z");

		const decision = evaluateSchedule(now, {
			...baseSchedule,
			enabled: true,
			intervalHours: 24,
			lastRunAt: null,
			nextRunAt: new Date("2026-03-28T10:00:00Z"),
		});

		expect(decision.shouldRun).toBe(true);
		// 2026-03-29 02:00 Warsaw → falls forward to 03:00 CEST = 01:00 UTC
		expect(decision.nextRunAt).toEqual(new Date("2026-03-29T01:00:00Z"));
	});

	it("DST fall back: anchor 02:00 on 2026-10-25 (doubled) fires exactly once (resolves to 02:00 CET = 01:00 UTC)", () => {
		// Poland DST fall back 2026: 2026-10-25 03:00 CEST → 02:00 CET (02:00 happens twice)
		// Library resolves ambiguous local times to the standard-time (CET) instant.
		// What matters per PRD: fires once, not twice.
		const now = new Date("2026-10-24T12:00:00Z");

		const decision = evaluateSchedule(now, {
			...baseSchedule,
			enabled: true,
			intervalHours: 24,
			lastRunAt: null,
			nextRunAt: new Date("2026-10-24T10:00:00Z"),
		});

		expect(decision.shouldRun).toBe(true);
		expect(decision.nextRunAt).toEqual(new Date("2026-10-25T01:00:00Z"));
	});

	it("interval 168h (7d) with anchor 02:00 on a Sunday anchors to the same weekday's anchor slot", () => {
		// 2026-05-11 is a Monday. With 7d interval and anchor 02:00, next slot = 2026-05-18 02:00 CEST = 00:00 UTC
		const now = new Date("2026-05-11T12:00:00Z");

		const decision = evaluateSchedule(now, {
			...baseSchedule,
			enabled: true,
			intervalHours: 168,
			lastRunAt: null,
			nextRunAt: new Date("2026-05-11T10:00:00Z"),
		});

		expect(decision.shouldRun).toBe(true);
		expect(decision.nextRunAt).toEqual(new Date("2026-05-18T00:00:00Z"));
	});
});
