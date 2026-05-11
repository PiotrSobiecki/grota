import { getDeployment } from "@repo/data-ops/deployment";
import { getDueSchedules, updateScheduleAfterRun } from "@repo/data-ops/schedule";
import { triggerScheduledCycle } from "../hono/services/migration-service";
import { evaluateSchedule } from "./evaluate-schedule";

export type RunDueSchedulesEnv = Env;

export interface RunDueSchedulesResult {
	attempted: number;
	succeeded: number;
	failed: number;
}

export async function runDueSchedules(
	env: RunDueSchedulesEnv,
	now: Date,
): Promise<RunDueSchedulesResult> {
	const due = await getDueSchedules(now);
	let succeeded = 0;
	let failed = 0;

	for (const schedule of due) {
		const decision = evaluateSchedule(now, schedule);
		if (!decision.shouldRun) continue;

		const deployment = await getDeployment(schedule.deploymentId);
		if (!deployment) {
			failed++;
			continue;
		}

		const result = await triggerScheduledCycle({
			deploymentId: schedule.deploymentId,
			triggeredByUserId: deployment.createdBy,
			env,
		});

		if (result.ok) {
			await updateScheduleAfterRun(schedule.deploymentId, {
				lastRunAt: now,
				nextRunAt: decision.nextRunAt,
				lastJobId: result.data.id,
				lastStatus: "ok",
			});
			succeeded++;
		} else {
			await updateScheduleAfterRun(schedule.deploymentId, {
				lastRunAt: now,
				nextRunAt: schedule.nextRunAt ?? now,
				lastStatus: `failed:${result.error.code}`,
			});
			failed++;
		}
	}

	return { attempted: due.length, succeeded, failed };
}
