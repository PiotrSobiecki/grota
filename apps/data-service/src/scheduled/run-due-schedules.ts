import { getDeployment } from "@repo/data-ops/deployment";
import { getActiveMigrationJob } from "@repo/data-ops/migration";
import {
	type DeploymentSchedule,
	getDueSchedules,
	updateScheduleAfterRun,
} from "@repo/data-ops/schedule";
import { notifyJobFailed } from "../hono/services/alert-service";
import { triggerScheduledCycle } from "../hono/services/migration-service";
import { evaluateSchedule } from "./evaluate-schedule";

export type RunDueSchedulesEnv = Env;

export interface RunDueSchedulesResult {
	attempted: number;
	succeeded: number;
	failed: number;
}

type Outcome = "succeeded" | "failed" | "skipped";

const TRANSIENT_ERROR_CODES = new Set([
	"RUNNER_UNREACHABLE",
	"RUNNER_REJECTED",
	"RUNNER_INVALID_RESPONSE",
]);

const RETRY_DELAY_MS = 5 * 60 * 1000;

export async function runDueSchedules(
	env: RunDueSchedulesEnv,
	now: Date,
): Promise<RunDueSchedulesResult> {
	const due = await getDueSchedules(now);
	let succeeded = 0;
	let failed = 0;

	for (const schedule of due) {
		const outcome = await dispatchOne(env, now, schedule);
		if (outcome === "succeeded") succeeded++;
		else if (outcome === "failed") failed++;
	}

	return { attempted: due.length, succeeded, failed };
}

async function dispatchOne(
	env: RunDueSchedulesEnv,
	now: Date,
	schedule: DeploymentSchedule,
): Promise<Outcome | "noop"> {
	const decision = evaluateSchedule(now, schedule);
	if (!decision.shouldRun) return "noop";

	const deployment = await getDeployment(schedule.deploymentId);
	if (!deployment) return "failed";

	const active = await getActiveMigrationJob(schedule.deploymentId);
	if (active) {
		await updateScheduleAfterRun(schedule.deploymentId, {
			lastRunAt: now,
			nextRunAt: new Date(now.getTime() + schedule.intervalHours * 60 * 60 * 1000),
			lastStatus: "skipped:locked",
			retryAttemptsRemaining: 0,
		});
		return "skipped";
	}

	const result = await triggerScheduledCycle({
		deploymentId: schedule.deploymentId,
		triggeredByUserId: deployment.createdBy,
		triggeredByCron: true,
		env,
	});

	if (result.ok) {
		await updateScheduleAfterRun(schedule.deploymentId, {
			lastRunAt: now,
			nextRunAt: decision.nextRunAt,
			lastJobId: result.data.id,
			lastStatus: "ok",
			retryAttemptsRemaining: 0,
		});
		return "succeeded";
	}

	if (TRANSIENT_ERROR_CODES.has(result.error.code)) {
		await handleTransientFailure(now, schedule, deployment.clientName, env);
	} else {
		await updateScheduleAfterRun(schedule.deploymentId, {
			lastRunAt: now,
			nextRunAt: schedule.nextRunAt ?? now,
			lastStatus: `failed:${result.error.code}`,
		});
	}
	return "failed";
}

async function handleTransientFailure(
	now: Date,
	schedule: DeploymentSchedule,
	clientName: string,
	env: RunDueSchedulesEnv,
): Promise<void> {
	if (schedule.retryAttemptsRemaining > 0) {
		const intervalMs = schedule.intervalHours * 60 * 60 * 1000;
		await updateScheduleAfterRun(schedule.deploymentId, {
			lastRunAt: now,
			nextRunAt: new Date(now.getTime() + intervalMs),
			lastStatus: "failed",
			retryAttemptsRemaining: 0,
		});
		await notifyJobFailed(
			{
				deploymentId: schedule.deploymentId,
				jobId: null,
				reason: "retry_exhausted",
				clientName,
				exitCode: null,
				logTail: null,
			},
			env,
		);
		return;
	}
	await updateScheduleAfterRun(schedule.deploymentId, {
		lastRunAt: now,
		nextRunAt: new Date(now.getTime() + RETRY_DELAY_MS),
		lastStatus: "retry_pending",
		retryAttemptsRemaining: 1,
	});
}
