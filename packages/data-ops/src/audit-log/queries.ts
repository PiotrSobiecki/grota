import { desc, eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { ScheduleAuditAction, ScheduleAuditEntry, ServerConfigAuditEntry } from "./schema";
import { scheduleAuditLog, serverConfigAuditLog } from "./table";

export interface RecordServerConfigChangeInput {
	deploymentId: string;
	userId: string;
	changedFields: string[];
}

export async function recordServerConfigChange(
	input: RecordServerConfigChangeInput,
): Promise<ServerConfigAuditEntry> {
	const db = getDb();
	const result = await db
		.insert(serverConfigAuditLog)
		.values({
			deploymentId: input.deploymentId,
			userId: input.userId,
			changedFields: input.changedFields,
		})
		.returning();
	const row = result[0];
	if (!row) throw new Error("Insert into server_config_audit_log returned no rows");
	return row as ServerConfigAuditEntry;
}

export async function getServerConfigAuditLog(
	deploymentId: string,
): Promise<ServerConfigAuditEntry[]> {
	const db = getDb();
	const result = await db
		.select()
		.from(serverConfigAuditLog)
		.where(eq(serverConfigAuditLog.deploymentId, deploymentId))
		.orderBy(desc(serverConfigAuditLog.changedAt));
	return result as ServerConfigAuditEntry[];
}

export interface RecordScheduleChangeInput {
	deploymentId: string;
	userId: string;
	action: ScheduleAuditAction;
	diff: Record<string, unknown>;
}

export async function recordScheduleChange(
	input: RecordScheduleChangeInput,
): Promise<ScheduleAuditEntry> {
	const db = getDb();
	const result = await db
		.insert(scheduleAuditLog)
		.values({
			deploymentId: input.deploymentId,
			userId: input.userId,
			action: input.action,
			diff: input.diff,
		})
		.returning();
	const row = result[0];
	if (!row) throw new Error("Insert into schedule_audit_log returned no rows");
	return row as ScheduleAuditEntry;
}

export async function getScheduleAuditLog(deploymentId: string): Promise<ScheduleAuditEntry[]> {
	const db = getDb();
	const result = await db
		.select()
		.from(scheduleAuditLog)
		.where(eq(scheduleAuditLog.deploymentId, deploymentId))
		.orderBy(desc(scheduleAuditLog.changedAt));
	return result as ScheduleAuditEntry[];
}
