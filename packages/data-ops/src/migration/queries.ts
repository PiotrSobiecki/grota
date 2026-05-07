import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { MigrationJob, MigrationJobStatus, MigrationJobType } from "./schema";
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

export async function getActiveMigrationJob(
	deploymentId: string,
): Promise<MigrationJob | null> {
	const db = getDb();
	const result = await db
		.select()
		.from(migrationJobs)
		.where(
			and(
				eq(migrationJobs.deploymentId, deploymentId),
				inArray(migrationJobs.status, ["queued", "running"]),
			),
		)
		.orderBy(desc(migrationJobs.startedAt))
		.limit(1);
	return (result[0] as MigrationJob | undefined) ?? null;
}

export async function getMigrationJob(id: string): Promise<MigrationJob | null> {
	const db = getDb();
	const result = await db
		.select()
		.from(migrationJobs)
		.where(eq(migrationJobs.id, id));
	return (result[0] as MigrationJob | undefined) ?? null;
}

export interface ListMigrationJobsInput {
	deploymentId: string;
	limit: number;
	offset: number;
}

export async function listMigrationJobs(
	input: ListMigrationJobsInput,
): Promise<MigrationJob[]> {
	const db = getDb();
	const result = await db
		.select()
		.from(migrationJobs)
		.where(eq(migrationJobs.deploymentId, input.deploymentId))
		.orderBy(desc(migrationJobs.startedAt))
		.limit(input.limit)
		.offset(input.offset);
	return result as MigrationJob[];
}

export interface UpdateMigrationJobStatusInput {
	status: MigrationJobStatus;
	exitCode?: number | null;
}

export async function updateMigrationJobStatus(
	id: string,
	input: UpdateMigrationJobStatusInput,
): Promise<MigrationJob | null> {
	const db = getDb();
	const isTerminal = input.status === "done" || input.status === "failed";
	const patch: {
		status: MigrationJobStatus;
		exitCode?: number | null;
		finishedAt?: Date;
	} = { status: input.status };
	if (input.exitCode !== undefined) patch.exitCode = input.exitCode;
	if (isTerminal) patch.finishedAt = new Date();

	const result = await db
		.update(migrationJobs)
		.set(patch)
		.where(eq(migrationJobs.id, id))
		.returning();
	return (result[0] as MigrationJob | undefined) ?? null;
}
