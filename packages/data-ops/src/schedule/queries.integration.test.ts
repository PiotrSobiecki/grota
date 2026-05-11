import { describe, expect, it } from "vitest";
import { createTestDeployment } from "@/test/fixtures";
import { getDueSchedules, getSchedule, setSchedule, updateScheduleAfterRun } from "./queries";

const defaultInput = {
	enabled: true,
	intervalHours: 24 as const,
	anchorTime: "02:00",
};

describe("setSchedule (integration)", () => {
	it("creates schedule with all fields and next_run_at=now() on first enable", async () => {
		const deployment = await createTestDeployment();
		const before = new Date();

		const stored = await setSchedule(deployment.id, defaultInput);

		expect(stored.enabled).toBe(true);
		expect(stored.intervalHours).toBe(24);
		expect(stored.anchorTime).toBe("02:00:00");
		expect(stored.anchorTimezone).toBe("Europe/Warsaw");
		if (!stored.nextRunAt) throw new Error("expected nextRunAt to be set");
		expect(stored.nextRunAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
		expect(stored.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
	});

	it("updates interval and anchor on subsequent calls without re-bootstrapping next_run_at when disabling", async () => {
		const deployment = await createTestDeployment();
		await setSchedule(deployment.id, defaultInput);
		const firstEnabled = await getSchedule(deployment.id);

		await setSchedule(deployment.id, {
			enabled: false,
			intervalHours: 6,
			anchorTime: "08:00",
		});
		const afterDisable = await getSchedule(deployment.id);

		expect(afterDisable?.enabled).toBe(false);
		expect(afterDisable?.intervalHours).toBe(6);
		expect(afterDisable?.anchorTime).toBe("08:00:00");
		expect(afterDisable?.nextRunAt?.getTime()).toBe(firstEnabled?.nextRunAt?.getTime());
	});
});

describe("getDueSchedules (integration)", () => {
	it("returns only enabled schedules whose next_run_at <= now", async () => {
		const due = await createTestDeployment();
		const future = await createTestDeployment();
		const disabled = await createTestDeployment();

		await setSchedule(due.id, defaultInput);
		await setSchedule(future.id, defaultInput);
		await setSchedule(disabled.id, defaultInput);
		await setSchedule(disabled.id, { ...defaultInput, enabled: false });

		await updateScheduleAfterRun(future.id, {
			lastRunAt: new Date(),
			nextRunAt: new Date(Date.now() + 60 * 60 * 1000),
		});

		const result = await getDueSchedules(new Date());
		const ids = result.map((s) => s.deploymentId);
		expect(ids).toContain(due.id);
		expect(ids).not.toContain(future.id);
		expect(ids).not.toContain(disabled.id);
	});
});

describe("updateScheduleAfterRun (integration)", () => {
	it("persists last_run_at, next_run_at, last_job_id, last_status", async () => {
		const deployment = await createTestDeployment();
		await setSchedule(deployment.id, defaultInput);

		const lastRunAt = new Date("2026-05-11T12:00:00Z");
		const nextRunAt = new Date("2026-05-12T00:00:00Z");
		await updateScheduleAfterRun(deployment.id, {
			lastRunAt,
			nextRunAt,
			lastStatus: "ok",
		});

		const stored = await getSchedule(deployment.id);
		expect(stored?.lastRunAt?.toISOString()).toBe(lastRunAt.toISOString());
		expect(stored?.nextRunAt?.toISOString()).toBe(nextRunAt.toISOString());
		expect(stored?.lastStatus).toBe("ok");
	});
});
