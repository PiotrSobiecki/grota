import { describe, expect, it } from "vitest";
import { evaluateSchedule } from "./evaluate-schedule";

describe("evaluateSchedule", () => {
	it("returns shouldRun=false when schedule is disabled, even if due", () => {
		const now = new Date("2026-05-11T12:00:00Z");
		const pastNextRun = new Date("2026-05-11T10:00:00Z");

		const decision = evaluateSchedule(now, {
			enabled: false,
			intervalHours: 24,
			nextRunAt: pastNextRun,
		});

		expect(decision.shouldRun).toBe(false);
		expect(decision.nextRunAt).toEqual(pastNextRun);
	});

	it("returns shouldRun=false when enabled but nextRunAt is in the future", () => {
		const now = new Date("2026-05-11T12:00:00Z");
		const futureNextRun = new Date("2026-05-11T20:00:00Z");

		const decision = evaluateSchedule(now, {
			enabled: true,
			intervalHours: 24,
			nextRunAt: futureNextRun,
		});

		expect(decision.shouldRun).toBe(false);
		expect(decision.nextRunAt).toEqual(futureNextRun);
	});

	it("returns shouldRun=true and advances nextRunAt by intervalHours when due", () => {
		const now = new Date("2026-05-11T12:00:00Z");
		const pastNextRun = new Date("2026-05-11T10:00:00Z");

		const decision = evaluateSchedule(now, {
			enabled: true,
			intervalHours: 24,
			nextRunAt: pastNextRun,
		});

		expect(decision.shouldRun).toBe(true);
		expect(decision.nextRunAt).toEqual(new Date("2026-05-12T12:00:00Z"));
	});

	it("returns shouldRun=true on bootstrap (nextRunAt is null) and sets nextRunAt to now + interval", () => {
		const now = new Date("2026-05-11T12:00:00Z");

		const decision = evaluateSchedule(now, {
			enabled: true,
			intervalHours: 24,
			nextRunAt: null,
		});

		expect(decision.shouldRun).toBe(true);
		expect(decision.nextRunAt).toEqual(new Date("2026-05-12T12:00:00Z"));
	});
});
