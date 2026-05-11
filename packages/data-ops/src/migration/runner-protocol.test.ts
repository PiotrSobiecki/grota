import { describe, expect, it } from "vitest";
import {
	BackupRequestSchema,
	GDriveRestoreRequestSchema,
	IngestRequestSchema,
	JobCreatedResponseSchema,
	LogLineSchema,
	MigrateRequestSchema,
	RunnerJobConfigSchema,
	RunnerJobSchema,
	RunnerJobStatusSchema,
} from "./runner-protocol";

const validRunnerConfig = {
	b2KeyId: "K001abc",
	b2AppKey: "supersecret",
	bucketPrefix: "client-x",
	backupPath: "/var/backups/grota",
};

describe("RunnerJobStatusSchema", () => {
	it.each(["queued", "running", "done", "failed"])("accepts status %s", (status) => {
		expect(RunnerJobStatusSchema.safeParse(status).success).toBe(true);
	});

	it("rejects unknown statuses", () => {
		expect(RunnerJobStatusSchema.safeParse("processing").success).toBe(false);
	});
});

describe("RunnerJobSchema", () => {
	it("parses a complete running job", () => {
		const result = RunnerJobSchema.safeParse({
			id: "11111111-1111-4111-8111-111111111111",
			status: "running",
			exitCode: null,
			startedAt: "2026-05-05T10:00:00.000Z",
			finishedAt: null,
		});
		expect(result.success).toBe(true);
	});
});

describe("BackupRequestSchema", () => {
	it("accepts an empty body (backup all)", () => {
		expect(BackupRequestSchema.safeParse({}).success).toBe(true);
	});

	it("accepts a body with a specific account", () => {
		expect(BackupRequestSchema.safeParse({ account: "user@example.com" }).success).toBe(true);
	});

	it("rejects a body with non-email account", () => {
		expect(BackupRequestSchema.safeParse({ account: "not-an-email" }).success).toBe(false);
	});

	it("accepts a body with full runnerConfig", () => {
		expect(BackupRequestSchema.safeParse({ runnerConfig: validRunnerConfig }).success).toBe(true);
	});

	it("rejects body where runnerConfig.b2KeyId is empty", () => {
		expect(
			BackupRequestSchema.safeParse({
				runnerConfig: { ...validRunnerConfig, b2KeyId: "" },
			}).success,
		).toBe(false);
	});

	it("accepts a body with optional bwlimit on runnerConfig", () => {
		expect(
			BackupRequestSchema.safeParse({
				runnerConfig: { ...validRunnerConfig, bwlimit: "10M" },
			}).success,
		).toBe(true);
	});
});

describe("MigrateRequestSchema", () => {
	it("defaults dryRun to false when omitted", () => {
		const result = MigrateRequestSchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.dryRun).toBe(false);
		}
	});

	it("accepts dryRun=true with an account", () => {
		expect(
			MigrateRequestSchema.safeParse({
				account: "user@example.com",
				dryRun: true,
			}).success,
		).toBe(true);
	});

	it("accepts a body with runnerConfig and dryRun", () => {
		expect(
			MigrateRequestSchema.safeParse({
				runnerConfig: validRunnerConfig,
				dryRun: true,
			}).success,
		).toBe(true);
	});
});

describe("RunnerJobConfigSchema", () => {
	it("requires b2KeyId, b2AppKey, bucketPrefix, backupPath", () => {
		expect(RunnerJobConfigSchema.safeParse(validRunnerConfig).success).toBe(true);
	});

	it("rejects missing backupPath", () => {
		const { backupPath: _omit, ...rest } = validRunnerConfig;
		expect(RunnerJobConfigSchema.safeParse(rest).success).toBe(false);
	});

	it("rejects empty bucketPrefix", () => {
		expect(
			RunnerJobConfigSchema.safeParse({ ...validRunnerConfig, bucketPrefix: "" }).success,
		).toBe(false);
	});
});

describe("JobCreatedResponseSchema", () => {
	it("requires a uuid jobId", () => {
		expect(
			JobCreatedResponseSchema.safeParse({
				jobId: "11111111-1111-4111-8111-111111111111",
			}).success,
		).toBe(true);
	});

	it("rejects a non-uuid jobId", () => {
		expect(JobCreatedResponseSchema.safeParse({ jobId: "abc" }).success).toBe(false);
	});
});

describe("LogLineSchema", () => {
	it("parses an stdout line", () => {
		const result = LogLineSchema.safeParse({
			ts: "2026-05-05T10:00:00.000Z",
			stream: "stdout",
			line: "rclone: copying file...",
		});
		expect(result.success).toBe(true);
	});

	it("rejects an unknown stream", () => {
		const result = LogLineSchema.safeParse({
			ts: "2026-05-05T10:00:00.000Z",
			stream: "syslog",
			line: "x",
		});
		expect(result.success).toBe(false);
	});
});

describe("GDriveRestoreRequestSchema", () => {
	const validRequest = {
		account: "user@example.com",
		runnerConfig: validRunnerConfig,
		gdrive: {
			clientId: "google-client-id",
			clientSecret: "google-client-secret",
			accessToken: "ya29.a0Af...",
			refreshToken: "1//0g...",
			expiry: "2026-05-07T12:00:00.000Z",
			sharedDriveId: "0ABC123XYZ",
		},
	};

	it("accepts a complete valid request", () => {
		expect(GDriveRestoreRequestSchema.safeParse(validRequest).success).toBe(true);
	});

	it("requires account email", () => {
		const { account: _account, ...withoutAccount } = validRequest;
		expect(GDriveRestoreRequestSchema.safeParse(withoutAccount).success).toBe(false);
	});

	it("requires gdrive credentials", () => {
		const { gdrive: _gdrive, ...withoutGDrive } = validRequest;
		expect(GDriveRestoreRequestSchema.safeParse(withoutGDrive).success).toBe(false);
	});

	it("requires runnerConfig (B2 source for fallback re-fetch)", () => {
		const { runnerConfig: _rc, ...withoutConfig } = validRequest;
		expect(GDriveRestoreRequestSchema.safeParse(withoutConfig).success).toBe(false);
	});

	it("rejects invalid email", () => {
		expect(
			GDriveRestoreRequestSchema.safeParse({ ...validRequest, account: "not-email" }).success,
		).toBe(false);
	});
});

describe("IngestRequestSchema", () => {
	const validIngestRequest = {
		account: "user@example.com",
		runnerConfig: validRunnerConfig,
		gdrive: {
			clientId: "google-client-id",
			clientSecret: "google-client-secret",
			accessToken: "ya29.a0Af...",
			refreshToken: "1//0g...",
			expiry: "2026-05-07T12:00:00.000Z",
		},
		folders: [
			{
				itemId: "1aBcDeF",
				itemName: "Reports",
				itemType: "folder" as const,
				parentFolderId: "0ROOT",
				sharedDriveName: "ClientX",
				sharedDriveId: "0ABC123",
				mimeType: "application/vnd.google-apps.folder",
			},
		],
	};

	it("accepts a complete valid request", () => {
		expect(IngestRequestSchema.safeParse(validIngestRequest).success).toBe(true);
	});

	it("rejects missing account", () => {
		const { account: _a, ...rest } = validIngestRequest;
		expect(IngestRequestSchema.safeParse(rest).success).toBe(false);
	});

	it("rejects non-email account", () => {
		expect(
			IngestRequestSchema.safeParse({ ...validIngestRequest, account: "not-email" }).success,
		).toBe(false);
	});

	it("rejects missing gdrive credentials", () => {
		const { gdrive: _g, ...rest } = validIngestRequest;
		expect(IngestRequestSchema.safeParse(rest).success).toBe(false);
	});

	it("rejects missing runnerConfig", () => {
		const { runnerConfig: _r, ...rest } = validIngestRequest;
		expect(IngestRequestSchema.safeParse(rest).success).toBe(false);
	});

	it("rejects empty folders array", () => {
		expect(IngestRequestSchema.safeParse({ ...validIngestRequest, folders: [] }).success).toBe(
			false,
		);
	});

	it("accepts folder with sharedDriveName: null (skipped by runner per D4)", () => {
		expect(
			IngestRequestSchema.safeParse({
				...validIngestRequest,
				folders: [{ ...validIngestRequest.folders[0], sharedDriveName: null }],
			}).success,
		).toBe(true);
	});

	it("rejects unknown itemType", () => {
		expect(
			IngestRequestSchema.safeParse({
				...validIngestRequest,
				folders: [{ ...validIngestRequest.folders[0], itemType: "shortcut" }],
			}).success,
		).toBe(false);
	});

	it("accepts folder with mimeType: null (DB legacy rows)", () => {
		expect(
			IngestRequestSchema.safeParse({
				...validIngestRequest,
				folders: [{ ...validIngestRequest.folders[0], mimeType: null }],
			}).success,
		).toBe(true);
	});

	it("accepts folder with sharedDriveId: null (file not on a shared drive)", () => {
		expect(
			IngestRequestSchema.safeParse({
				...validIngestRequest,
				folders: [{ ...validIngestRequest.folders[0], sharedDriveId: null }],
			}).success,
		).toBe(true);
	});

	it("rejects folder missing sharedDriveId (data-service must always provide it, even null)", () => {
		const { sharedDriveId: _sd, ...folderWithoutSdId } = validIngestRequest.folders[0];
		expect(
			IngestRequestSchema.safeParse({
				...validIngestRequest,
				folders: [folderWithoutSdId],
			}).success,
		).toBe(false);
	});

	it("accepts folder with parentFolderId: null (Drive root)", () => {
		expect(
			IngestRequestSchema.safeParse({
				...validIngestRequest,
				folders: [{ ...validIngestRequest.folders[0], parentFolderId: null }],
			}).success,
		).toBe(true);
	});
});
