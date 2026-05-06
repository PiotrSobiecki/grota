import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createTestDeployment,
	createTestUser,
	resetTestDatabase,
} from "@/test/fixtures";
import { createMigrationJob, getMigrationJob } from "./queries";

describe("migration queries (integration)", () => {
	beforeEach(async () => {
		await resetTestDatabase();
	});

	describe("createMigrationJob", () => {
		it("inserts a backup job and returns the persisted row", async () => {
			const deployment = await createTestDeployment();
			const user = await createTestUser();
			const runnerJobId = randomUUID();

			const job = await createMigrationJob({
				deploymentId: deployment.id,
				type: "backup",
				account: null,
				dryRun: false,
				runnerJobId,
				triggeredByUserId: user.id,
			});

			expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(job.deploymentId).toBe(deployment.id);
			expect(job.type).toBe("backup");
			expect(job.account).toBeNull();
			expect(job.dryRun).toBe(false);
			expect(job.status).toBe("queued");
			expect(job.runnerJobId).toBe(runnerJobId);
			expect(job.triggeredByUserId).toBe(user.id);
			expect(job.exitCode).toBeNull();
			expect(job.finishedAt).toBeNull();
			expect(job.startedAt).toBeInstanceOf(Date);
		});

		it("persists optional account and dryRun=true for migrate jobs", async () => {
			const deployment = await createTestDeployment();
			const user = await createTestUser();

			const job = await createMigrationJob({
				deploymentId: deployment.id,
				type: "migrate",
				account: "user@example.com",
				dryRun: true,
				runnerJobId: randomUUID(),
				triggeredByUserId: user.id,
			});

			expect(job.type).toBe("migrate");
			expect(job.account).toBe("user@example.com");
			expect(job.dryRun).toBe(true);
		});
	});

	describe("getMigrationJob", () => {
		it("returns null for unknown id", async () => {
			const result = await getMigrationJob(randomUUID());
			expect(result).toBeNull();
		});

		it("returns the persisted job by id", async () => {
			const deployment = await createTestDeployment();
			const user = await createTestUser();
			const created = await createMigrationJob({
				deploymentId: deployment.id,
				type: "backup",
				account: null,
				dryRun: false,
				runnerJobId: randomUUID(),
				triggeredByUserId: user.id,
			});

			const fetched = await getMigrationJob(created.id);
			expect(fetched?.id).toBe(created.id);
			expect(fetched?.deploymentId).toBe(deployment.id);
		});
	});
});
