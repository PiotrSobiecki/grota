import { z } from "zod";

export const RunnerJobStatusSchema = z.enum(["queued", "running", "done", "failed"]);

export const RunnerJobSchema = z.object({
	id: z.string().uuid(),
	status: RunnerJobStatusSchema,
	exitCode: z.number().int().nullable(),
	startedAt: z.string().datetime(),
	finishedAt: z.string().datetime().nullable(),
});

export const RunnerJobConfigSchema = z.object({
	b2KeyId: z.string().min(1),
	b2AppKey: z.string().min(1),
	bucketPrefix: z.string().min(1),
	backupPath: z.string().min(1),
	bwlimit: z.string().min(1).optional(),
});

export const BackupRequestSchema = z.object({
	account: z.string().email().optional(),
	runnerConfig: RunnerJobConfigSchema.optional(),
});

export const MigrateRequestSchema = z.object({
	account: z.string().email().optional(),
	dryRun: z.boolean().default(false),
	runnerConfig: RunnerJobConfigSchema.optional(),
});

export const JobCreatedResponseSchema = z.object({
	jobId: z.string().uuid(),
});

export const LogLineSchema = z.object({
	ts: z.string().datetime(),
	stream: z.enum(["stdout", "stderr"]),
	line: z.string(),
});

export const GDriveCredentialsSchema = z.object({
	clientId: z.string().min(1),
	clientSecret: z.string().min(1),
	accessToken: z.string().min(1),
	refreshToken: z.string().min(1),
	expiry: z.string().datetime(),
	sharedDriveId: z.string().min(1).optional(),
	targetFolder: z.string().min(1).optional(),
});

export const GDriveRestoreRequestSchema = z.object({
	account: z.string().email(),
	runnerConfig: RunnerJobConfigSchema,
	gdrive: GDriveCredentialsSchema,
});

export const B2VerifyRequestSchema = z.object({
	b2KeyId: z.string().min(1),
	b2AppKey: z.string().min(1),
	bucketPrefix: z.string().min(1),
});

export const B2VerifyResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});

export type RunnerJobStatus = z.infer<typeof RunnerJobStatusSchema>;
export type RunnerJob = z.infer<typeof RunnerJobSchema>;
export type RunnerJobConfig = z.infer<typeof RunnerJobConfigSchema>;
export type BackupRequest = z.infer<typeof BackupRequestSchema>;
export type MigrateRequest = z.infer<typeof MigrateRequestSchema>;
export type JobCreatedResponse = z.infer<typeof JobCreatedResponseSchema>;
export type LogLine = z.infer<typeof LogLineSchema>;
export type B2VerifyRequest = z.infer<typeof B2VerifyRequestSchema>;
export type B2VerifyResponse = z.infer<typeof B2VerifyResponseSchema>;
export type GDriveCredentials = z.infer<typeof GDriveCredentialsSchema>;
export type GDriveRestoreRequest = z.infer<typeof GDriveRestoreRequestSchema>;
