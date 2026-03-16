import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { SharedDrive, SharedDriveUpsertInput } from "./schema";
import { sharedDrives } from "./table";

export async function getSharedDrivesByDeployment(deploymentId: string): Promise<SharedDrive[]> {
	const db = getDb();
	const rows = await db
		.select()
		.from(sharedDrives)
		.where(eq(sharedDrives.deploymentId, deploymentId));
	return rows as SharedDrive[];
}

export async function upsertSharedDrives(
	deploymentId: string,
	drives: SharedDriveUpsertInput[],
): Promise<SharedDrive[]> {
	const db = getDb();
	await db.delete(sharedDrives).where(eq(sharedDrives.deploymentId, deploymentId));
	if (drives.length === 0) return [];
	const rows = await db
		.insert(sharedDrives)
		.values(
			drives.map((d) => ({
				deploymentId,
				name: d.name,
				retentionDays: d.retentionDays ?? null,
				googleDriveId: d.googleDriveId ?? null,
			})),
		)
		.returning();
	return rows as SharedDrive[];
}

export async function deleteSharedDrivesByDeployment(deploymentId: string): Promise<void> {
	const db = getDb();
	await db.delete(sharedDrives).where(eq(sharedDrives.deploymentId, deploymentId));
}
