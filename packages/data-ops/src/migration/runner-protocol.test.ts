import { describe, expect, it } from "vitest";
import {
	BackupRequestSchema,
	JobCreatedResponseSchema,
	LogLineSchema,
	MigrateRequestSchema,
	RunnerJobSchema,
	RunnerJobStatusSchema,
} from "./runner-protocol";

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
		expect(
			BackupRequestSchema.safeParse({ account: "user@example.com" }).success,
		).toBe(true);
	});

	it("rejects a body with non-email account", () => {
		expect(BackupRequestSchema.safeParse({ account: "not-an-email" }).success).toBe(false);
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
