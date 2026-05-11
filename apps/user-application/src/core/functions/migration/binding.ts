import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { protectedFunctionMiddleware } from "@/core/middleware/auth";
import { fetchDataService } from "@/lib/data-service";

export interface MigrationJobDto {
	id: string;
	deploymentId: string;
	type: "backup" | "migrate" | "gdrive-restore" | "ingest" | "scheduled-cycle";
	account: string | null;
	dryRun: boolean;
	status: "queued" | "running" | "done" | "failed";
	runnerJobId: string;
	startedAt: string;
	finishedAt: string | null;
	exitCode: number | null;
	triggeredByUserId: string;
}

const TriggerBackupInput = z.object({
	deploymentId: z.string().uuid(),
	account: z.string().email().optional(),
});

const TriggerMigrateInput = z.object({
	deploymentId: z.string().uuid(),
	account: z.string().email().optional(),
	dryRun: z.boolean().optional(),
});

const TriggerGDriveRestoreInput = z.object({
	deploymentId: z.string().uuid(),
	account: z.string().email(),
});

const TriggerIngestInput = z.object({
	deploymentId: z.string().uuid(),
	employeeId: z.string().uuid(),
});

const JobIdInput = z.object({ jobId: z.string().uuid() });

const ListJobsInput = z.object({
	deploymentId: z.string().uuid(),
	limit: z.number().int().min(1).max(100).optional(),
	offset: z.number().int().min(0).optional(),
});

async function postAdminMigration(
	path: string,
	body: unknown,
	operatorId: string,
	failureCode: string,
): Promise<MigrationJobDto> {
	const response = await fetchDataService(`/admin/migration${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.VITE_API_TOKEN}`,
			"content-type": "application/json",
			"X-Operator-Id": operatorId,
		},
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const errBody = (await response.json()) as { error?: string; code?: string };
		throw new AppError(
			errBody.error ?? "Operacja migracji nie powiodla sie",
			errBody.code ?? failureCode,
			response.status,
		);
	}
	return (await response.json()) as MigrationJobDto;
}

export const triggerBackupJob = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(TriggerBackupInput)
	.handler(async ({ data, context }) =>
		postAdminMigration(
			"/backup",
			{ deploymentId: data.deploymentId, account: data.account },
			context.userId,
			"MIGRATION_BACKUP_FAILED",
		),
	);

export const triggerMigrateJob = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(TriggerMigrateInput)
	.handler(async ({ data, context }) =>
		postAdminMigration(
			"/migrate",
			{
				deploymentId: data.deploymentId,
				account: data.account,
				dryRun: data.dryRun ?? false,
			},
			context.userId,
			"MIGRATION_MIGRATE_FAILED",
		),
	);

export const triggerGDriveRestoreJob = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(TriggerGDriveRestoreInput)
	.handler(async ({ data, context }) =>
		postAdminMigration(
			"/gdrive-restore",
			{ deploymentId: data.deploymentId, account: data.account },
			context.userId,
			"MIGRATION_GDRIVE_RESTORE_FAILED",
		),
	);

export const triggerIngestJob = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(TriggerIngestInput)
	.handler(async ({ data, context }) =>
		postAdminMigration(
			"/ingest",
			{ deploymentId: data.deploymentId, employeeId: data.employeeId },
			context.userId,
			"MIGRATION_INGEST_FAILED",
		),
	);

export const getMigrationJobStatus = createServerFn({ method: "GET" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(JobIdInput)
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/admin/migration/jobs/${data.jobId}`, {
			headers: { Authorization: `Bearer ${env.VITE_API_TOKEN}` },
		});
		if (!response.ok) {
			const errBody = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				errBody.error ?? "Nie udalo sie pobrac statusu joba",
				errBody.code ?? "MIGRATION_JOB_GET_FAILED",
				response.status,
			);
		}
		return (await response.json()) as MigrationJobDto;
	});

export const listMigrationJobs = createServerFn({ method: "GET" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(ListJobsInput)
	.handler(async ({ data }) => {
		const params = new URLSearchParams({ deploymentId: data.deploymentId });
		if (data.limit !== undefined) params.set("limit", String(data.limit));
		if (data.offset !== undefined) params.set("offset", String(data.offset));
		const response = await fetchDataService(`/admin/migration/jobs?${params.toString()}`, {
			headers: { Authorization: `Bearer ${env.VITE_API_TOKEN}` },
		});
		if (!response.ok) {
			const errBody = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				errBody.error ?? "Nie udalo sie pobrac listy jobow",
				errBody.code ?? "MIGRATION_JOB_LIST_FAILED",
				response.status,
			);
		}
		return (await response.json()) as MigrationJobDto[];
	});
