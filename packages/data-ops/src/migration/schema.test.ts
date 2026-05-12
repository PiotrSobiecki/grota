import { describe, expect, it } from "vitest";
import {
	MigrationJobSchema,
	MigrationJobTypeSchema,
	TriggerBackupRequestSchema,
	TriggerIngestRequestSchema,
	TriggerMigrateRequestSchema,
} from "./schema";

describe("MigrationJobTypeSchema", () => {
	it("accepts backup and migrate", () => {
		expect(MigrationJobTypeSchema.parse("backup")).toBe("backup");
		expect(MigrationJobTypeSchema.parse("migrate")).toBe("migrate");
	});

	it("accepts gdrive-restore", () => {
		expect(MigrationJobTypeSchema.parse("gdrive-restore")).toBe("gdrive-restore");
	});

	it("accepts ingest (employee Drive -> VPS first hop)", () => {
		expect(MigrationJobTypeSchema.parse("ingest")).toBe("ingest");
	});

	it("rejects unknown types", () => {
		expect(MigrationJobTypeSchema.safeParse("delete").success).toBe(false);
	});
});

describe("MigrationJobSchema", () => {
	const valid = {
		id: "11111111-1111-4111-8111-111111111111",
		deploymentId: "22222222-2222-4222-8222-222222222222",
		type: "backup",
		account: "user@example.com",
		dryRun: false,
		status: "running",
		runnerJobId: "33333333-3333-4333-8333-333333333333",
		startedAt: "2026-05-06T08:00:00Z",
		finishedAt: null,
		exitCode: null,
		triggeredByUserId: "user-abc",
		triggeredByCron: false,
	};

	it("parses a valid in-flight job and coerces startedAt to Date", () => {
		const parsed = MigrationJobSchema.parse(valid);
		expect(parsed.startedAt).toBeInstanceOf(Date);
		expect(parsed.finishedAt).toBeNull();
		expect(parsed.exitCode).toBeNull();
	});

	it("accepts null account (means all employees)", () => {
		const parsed = MigrationJobSchema.parse({ ...valid, account: null });
		expect(parsed.account).toBeNull();
	});

	it("parses a completed job with finishedAt + exitCode", () => {
		const parsed = MigrationJobSchema.parse({
			...valid,
			status: "done",
			finishedAt: "2026-05-06T08:05:00Z",
			exitCode: 0,
		});
		expect(parsed.status).toBe("done");
		expect(parsed.finishedAt).toBeInstanceOf(Date);
		expect(parsed.exitCode).toBe(0);
	});
});

describe("TriggerBackupRequestSchema", () => {
	it("requires deploymentId; account is optional", () => {
		const parsed = TriggerBackupRequestSchema.parse({
			deploymentId: "11111111-1111-4111-8111-111111111111",
		});
		expect(parsed.account).toBeUndefined();
	});

	it("rejects missing deploymentId", () => {
		expect(TriggerBackupRequestSchema.safeParse({}).success).toBe(false);
	});

	it("rejects bad email in account", () => {
		const result = TriggerBackupRequestSchema.safeParse({
			deploymentId: "11111111-1111-4111-8111-111111111111",
			account: "not-an-email",
		});
		expect(result.success).toBe(false);
	});
});

describe("TriggerIngestRequestSchema", () => {
	const valid = {
		deploymentId: "11111111-1111-4111-8111-111111111111",
		employeeId: "22222222-2222-4222-8222-222222222222",
	};

	it("requires deploymentId + employeeId as uuids", () => {
		expect(TriggerIngestRequestSchema.safeParse(valid).success).toBe(true);
	});

	it("rejects missing employeeId", () => {
		expect(TriggerIngestRequestSchema.safeParse({ deploymentId: valid.deploymentId }).success).toBe(
			false,
		);
	});

	it("rejects non-uuid employeeId", () => {
		expect(TriggerIngestRequestSchema.safeParse({ ...valid, employeeId: "abc" }).success).toBe(
			false,
		);
	});
});

describe("TriggerMigrateRequestSchema", () => {
	it("defaults dryRun to false", () => {
		const parsed = TriggerMigrateRequestSchema.parse({
			deploymentId: "11111111-1111-4111-8111-111111111111",
		});
		expect(parsed.dryRun).toBe(false);
	});

	it("accepts explicit dryRun=true", () => {
		const parsed = TriggerMigrateRequestSchema.parse({
			deploymentId: "11111111-1111-4111-8111-111111111111",
			dryRun: true,
		});
		expect(parsed.dryRun).toBe(true);
	});
});
