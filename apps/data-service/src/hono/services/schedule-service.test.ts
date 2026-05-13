import type { DeploymentSchedule } from "@repo/data-ops/schedule";
import { describe, expect, it } from "vitest";
import { detectScheduleChange } from "./schedule-service";

function baseSchedule(overrides: Partial<DeploymentSchedule> = {}): DeploymentSchedule {
	return {
		deploymentId: "11111111-1111-4111-8111-111111111111",
		enabled: true,
		intervalHours: 24,
		anchorTime: "02:00",
		anchorTimezone: "Europe/Warsaw",
		lastRunAt: null,
		nextRunAt: null,
		lastJobId: null,
		lastStatus: null,
		retryAttemptsRemaining: 0,
		includeGdriveRestore: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

describe("detectScheduleChange", () => {
	it("returns diff with includeGdriveRestore false→true and action schedule.updated", () => {
		const prev = baseSchedule({ includeGdriveRestore: false });
		const next = baseSchedule({ includeGdriveRestore: true });
		const change = detectScheduleChange(prev, next);
		expect(change).not.toBeNull();
		expect(change?.action).toBe("schedule.updated");
		expect(change?.diff.includeGdriveRestore).toEqual({ from: false, to: true });
	});

	it("returns null when no fields change (including includeGdriveRestore)", () => {
		const prev = baseSchedule({ includeGdriveRestore: true });
		const next = baseSchedule({ includeGdriveRestore: true });
		expect(detectScheduleChange(prev, next)).toBeNull();
	});

	it("toggling restore off while enabled stays true → diff contains only includeGdriveRestore, action schedule.updated, no diff.enabled", () => {
		const prev = baseSchedule({ enabled: true, includeGdriveRestore: true });
		const next = baseSchedule({ enabled: true, includeGdriveRestore: false });
		const change = detectScheduleChange(prev, next);
		expect(change).not.toBeNull();
		expect(change?.action).toBe("schedule.updated");
		expect(change?.diff).toEqual({
			includeGdriveRestore: { from: true, to: false },
		});
		expect(change?.diff).not.toHaveProperty("enabled");
	});

	it("does not include includeGdriveRestore in diff when only another field changes", () => {
		const prev = baseSchedule({ anchorTime: "02:00", includeGdriveRestore: false });
		const next = baseSchedule({ anchorTime: "03:00", includeGdriveRestore: false });
		const change = detectScheduleChange(prev, next);
		expect(change?.diff).toHaveProperty("anchorTime");
		expect(change?.diff).not.toHaveProperty("includeGdriveRestore");
	});
});
