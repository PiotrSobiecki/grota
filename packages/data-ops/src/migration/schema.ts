import { z } from "zod";
import { RunnerJobStatusSchema } from "./runner-protocol";

// ============================================
// Enums
// ============================================

export const MigrationJobTypeSchema = z.enum(["backup", "migrate", "gdrive-restore"]);
export const MigrationJobStatusSchema = RunnerJobStatusSchema;

// ============================================
// Domain Model
// ============================================

export const MigrationJobSchema = z.object({
	id: z.string().uuid(),
	deploymentId: z.string().uuid(),
	type: MigrationJobTypeSchema,
	account: z.string().email().nullable(),
	dryRun: z.boolean(),
	status: MigrationJobStatusSchema,
	runnerJobId: z.string().uuid(),
	startedAt: z.coerce.date(),
	finishedAt: z.coerce.date().nullable(),
	exitCode: z.number().int().nullable(),
	triggeredByUserId: z.string(),
});

// ============================================
// Request Schemas
// ============================================

export const TriggerBackupRequestSchema = z.object({
	deploymentId: z.string().uuid(),
	account: z.string().email().optional(),
});

export const TriggerMigrateRequestSchema = z.object({
	deploymentId: z.string().uuid(),
	account: z.string().email().optional(),
	dryRun: z.boolean().default(false),
});

export const TriggerGDriveRestoreRequestSchema = z.object({
	deploymentId: z.string().uuid(),
	account: z.string().email(),
});

export const MigrationJobIdParamSchema = z.object({
	id: z.string().uuid(),
});

export const MigrationJobListRequestSchema = z.object({
	deploymentId: z.string().uuid(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// ============================================
// Types
// ============================================

export type MigrationJobType = z.infer<typeof MigrationJobTypeSchema>;
export type MigrationJobStatus = z.infer<typeof MigrationJobStatusSchema>;
export type MigrationJob = z.infer<typeof MigrationJobSchema>;
export type TriggerBackupRequest = z.infer<typeof TriggerBackupRequestSchema>;
export type TriggerMigrateRequest = z.infer<typeof TriggerMigrateRequestSchema>;
export type TriggerGDriveRestoreRequest = z.infer<typeof TriggerGDriveRestoreRequestSchema>;
export type MigrationJobListRequest = z.infer<typeof MigrationJobListRequestSchema>;
