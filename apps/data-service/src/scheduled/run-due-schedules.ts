import { getDeployment } from "@repo/data-ops/deployment";
import { getDueSchedules, updateScheduleAfterRun } from "@repo/data-ops/schedule";
import { triggerBackup } from "../hono/services/migration-service";
import { evaluateSchedule } from "./evaluate-schedule";

export interface RunDueSchedulesEnv {
	encryptionKey: string;
}

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

		const result = await triggerBackup({
			deploymentId: schedule.deploymentId,
			triggeredByUserId: deployment.createdBy,
			encryptionKey: env.encryptionKey,
		});

		if (result.ok) {
			await updateScheduleAfterRun(schedule.deploymentId, {
				lastRunAt: now,
				nextRunAt: decision.nextRunAt,
			});
			succeeded++;
		} else {
			failed++;
		}
	}

	return { attempted: due.length, succeeded, failed };
}
