import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { MigrationJob, MigrationJobType } from "./schema";
import { migrationJobs } from "./table";

export interface CreateMigrationJobInput {
	deploymentId: string;
	type: MigrationJobType;
	account: string | null;
	dryRun: boolean;
	runnerJobId: string;
	triggeredByUserId: string;
}

export async function createMigrationJob(
	input: CreateMigrationJobInput,
): Promise<MigrationJob> {
	const db = getDb();
	const result = await db
		.insert(migrationJobs)
		.values({
			deploymentId: input.deploymentId,
			type: input.type,
			account: input.account,
			dryRun: input.dryRun,
			runnerJobId: input.runnerJobId,
			triggeredByUserId: input.triggeredByUserId,
		})
		.returning();
	const row = result[0];
	if (!row) {
		throw new Error("Insert into migration_jobs returned no rows");
	}
	return row as MigrationJob;
}

export async function getMigrationJob(id: string): Promise<MigrationJob | null> {
	const db = getDb();
	const result = await db
		.select()
		.from(migrationJobs)
		.where(eq(migrationJobs.id, id));
	return (result[0] as MigrationJob | undefined) ?? null;
}
