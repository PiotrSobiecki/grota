import { and, eq, lte } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { DeploymentSchedule } from "./schema";
import { deploymentSchedules } from "./table";

export async function getSchedule(deploymentId: string): Promise<DeploymentSchedule | null> {
	const db = getDb();
	const result = await db
		.select()
		.from(deploymentSchedules)
		.where(eq(deploymentSchedules.deploymentId, deploymentId));
	return result[0] ?? null;
}

export async function setScheduleEnabled(deploymentId: string, enabled: boolean): Promise<void> {
	const db = getDb();
	const now = new Date();
	if (enabled) {
		await db
			.insert(deploymentSchedules)
			.values({ deploymentId, enabled: true, nextRunAt: now })
			.onConflictDoUpdate({
				target: deploymentSchedules.deploymentId,
				set: { enabled: true, nextRunAt: now, updatedAt: now },
			});
		return;
	}
	await db
		.insert(deploymentSchedules)
		.values({ deploymentId, enabled: false })
		.onConflictDoUpdate({
			target: deploymentSchedules.deploymentId,
			set: { enabled: false, updatedAt: now },
		});
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
	values: { lastRunAt: Date; nextRunAt: Date },
): Promise<void> {
	const db = getDb();
	await db
		.update(deploymentSchedules)
		.set({ lastRunAt: values.lastRunAt, nextRunAt: values.nextRunAt })
		.where(eq(deploymentSchedules.deploymentId, deploymentId));
}
