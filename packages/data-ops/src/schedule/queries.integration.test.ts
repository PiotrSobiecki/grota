import { describe, expect, it } from "vitest";
import { createTestDeployment } from "@/test/fixtures";
import {
	getDueSchedules,
	getSchedule,
	setScheduleEnabled,
	updateScheduleAfterRun,
} from "./queries";

describe("setScheduleEnabled (integration)", () => {
	it("creates schedule with enabled=true and next_run_at=now() on first enable", async () => {
		const deployment = await createTestDeployment();
		const before = new Date();

		await setScheduleEnabled(deployment.id, true);

		const stored = await getSchedule(deployment.id);
		if (!stored) throw new Error("expected schedule to exist");
		expect(stored.enabled).toBe(true);
		expect(stored.intervalHours).toBe(24);
		if (!stored.nextRunAt) throw new Error("expected nextRunAt to be set");
		expect(stored.nextRunAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
		expect(stored.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
	});

	it("disables an existing schedule without resetting next_run_at", async () => {
		const deployment = await createTestDeployment();
		await setScheduleEnabled(deployment.id, true);
		const enabled = await getSchedule(deployment.id);

		await setScheduleEnabled(deployment.id, false);

		const disabled = await getSchedule(deployment.id);
		expect(disabled?.enabled).toBe(false);
		expect(disabled?.nextRunAt?.getTime()).toBe(enabled?.nextRunAt?.getTime());
	});
});

describe("getDueSchedules (integration)", () => {
	it("returns only enabled schedules whose next_run_at <= now", async () => {
		const dueDeployment = await createTestDeployment();
		const futureDeployment = await createTestDeployment();
		const disabledDeployment = await createTestDeployment();

		await setScheduleEnabled(dueDeployment.id, true);
		await setScheduleEnabled(futureDeployment.id, true);
		await setScheduleEnabled(disabledDeployment.id, true);
		await setScheduleEnabled(disabledDeployment.id, false);

		// Push future schedule into the future
		const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
		await updateScheduleAfterRun(futureDeployment.id, {
			lastRunAt: new Date(),
			nextRunAt: inOneHour,
		});

		const due = await getDueSchedules(new Date());
		const dueIds = due.map((s) => s.deploymentId);

		expect(dueIds).toContain(dueDeployment.id);
		expect(dueIds).not.toContain(futureDeployment.id);
		expect(dueIds).not.toContain(disabledDeployment.id);
	});
});

describe("updateScheduleAfterRun (integration)", () => {
	it("persists last_run_at and next_run_at", async () => {
		const deployment = await createTestDeployment();
		await setScheduleEnabled(deployment.id, true);

		const lastRunAt = new Date("2026-05-11T12:00:00Z");
		const nextRunAt = new Date("2026-05-12T12:00:00Z");
		await updateScheduleAfterRun(deployment.id, { lastRunAt, nextRunAt });

		const stored = await getSchedule(deployment.id);
		expect(stored?.lastRunAt?.toISOString()).toBe(lastRunAt.toISOString());
		expect(stored?.nextRunAt?.toISOString()).toBe(nextRunAt.toISOString());
	});
});
