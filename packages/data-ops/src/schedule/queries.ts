import { and, eq, lte } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { DeploymentSchedule, SetScheduleInput } from "./schema";
import { deploymentSchedules } from "./table";

export async function getSchedule(deploymentId: string): Promise<DeploymentSchedule | null> {
	const db = getDb();
	const result = await db
		.select()
		.from(deploymentSchedules)
		.where(eq(deploymentSchedules.deploymentId, deploymentId));
	return result[0] ?? null;
}

export async function setSchedule(
	deploymentId: string,
	input: SetScheduleInput,
): Promise<DeploymentSchedule> {
	const db = getDb();
	const now = new Date();
	const insertValues = {
		deploymentId,
		enabled: input.enabled,
		intervalHours: input.intervalHours,
		anchorTime: input.anchorTime,
		includeGdriveRestore: input.includeGdriveRestore,
		...(input.enabled ? { nextRunAt: now } : {}),
	};
	const updateSet: Record<string, unknown> = {
		enabled: input.enabled,
		intervalHours: input.intervalHours,
		anchorTime: input.anchorTime,
		includeGdriveRestore: input.includeGdriveRestore,
		updatedAt: now,
	};
	if (input.enabled) updateSet.nextRunAt = now;

	await db
		.insert(deploymentSchedules)
		.values(insertValues)
		.onConflictDoUpdate({ target: deploymentSchedules.deploymentId, set: updateSet });
	const stored = await getSchedule(deploymentId);
	if (!stored) throw new Error("Failed to persist schedule");
	return stored;
}

export async function getDueSchedules(now: Date): Promise<DeploymentSchedule[]> {
	const db = getDb();
	return db
		.select()
		.from(deploymentSchedules)
		.where(and(eq(deploymentSchedules.enabled, true), lte(deploymentSchedules.nextRunAt, now)));
}

export async function updateScheduleAfterRun(
	deploymentId: string,
	values: {
		lastRunAt: Date;
		nextRunAt: Date;
		lastJobId?: string | null;
		lastStatus?: string | null;
		retryAttemptsRemaining?: number;
	},
): Promise<void> {
	const db = getDb();
	const setValues: Record<string, unknown> = {
		lastRunAt: values.lastRunAt,
		nextRunAt: values.nextRunAt,
	};
	if (values.lastJobId !== undefined) setValues.lastJobId = values.lastJobId;
	if (values.lastStatus !== undefined) setValues.lastStatus = values.lastStatus;
	if (values.retryAttemptsRemaining !== undefined)
		setValues.retryAttemptsRemaining = values.retryAttemptsRemaining;
	await db
		.update(deploymentSchedules)
		.set(setValues)
		.where(eq(deploymentSchedules.deploymentId, deploymentId));
}
