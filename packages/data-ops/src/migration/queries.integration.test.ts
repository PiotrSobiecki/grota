import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDeployment, createTestUser, resetTestDatabase } from "@/test/fixtures";
import {
	createMigrationJob,
	getActiveMigrationJob,
	getMigrationJob,
	listMigrationJobs,
	updateMigrationJobStatus,
} from "./queries";

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

	describe("updateMigrationJobStatus", () => {
		async function seedJob() {
			const deployment = await createTestDeployment();
			const user = await createTestUser();
			return createMigrationJob({
				deploymentId: deployment.id,
				type: "backup",
				account: null,
				dryRun: false,
				runnerJobId: randomUUID(),
				triggeredByUserId: user.id,
			});
		}

		it("returns null for unknown id", async () => {
			const result = await updateMigrationJobStatus(randomUUID(), {
				status: "running",
			});
			expect(result).toBeNull();
		});

		it("updates status to running without setting finishedAt or exitCode", async () => {
			const job = await seedJob();
			const updated = await updateMigrationJobStatus(job.id, {
				status: "running",
			});
			expect(updated?.status).toBe("running");
			expect(updated?.finishedAt).toBeNull();
			expect(updated?.exitCode).toBeNull();
		});

		it("sets finishedAt and exitCode when transitioning to done", async () => {
			const job = await seedJob();
			const before = Date.now();
			const updated = await updateMigrationJobStatus(job.id, {
				status: "done",
				exitCode: 0,
			});
			expect(updated?.status).toBe("done");
			expect(updated?.exitCode).toBe(0);
			expect(updated?.finishedAt).toBeInstanceOf(Date);
			expect(updated?.finishedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
		});

		it("sets finishedAt and exitCode when transitioning to failed", async () => {
			const job = await seedJob();
			const updated = await updateMigrationJobStatus(job.id, {
				status: "failed",
				exitCode: 3,
			});
			expect(updated?.status).toBe("failed");
			expect(updated?.exitCode).toBe(3);
			expect(updated?.finishedAt).toBeInstanceOf(Date);
		});
	});

	describe("listMigrationJobs", () => {
		it("returns empty array for deployment with no jobs", async () => {
			const deployment = await createTestDeployment();
			const result = await listMigrationJobs({
				deploymentId: deployment.id,
				limit: 50,
				offset: 0,
			});
			expect(result).toEqual([]);
		});

		it("filters by deploymentId, orders by startedAt desc, respects limit + offset", async () => {
			const depA = await createTestDeployment();
			const depB = await createTestDeployment();
			const user = await createTestUser();

			const seed = (depId: string) =>
				createMigrationJob({
					deploymentId: depId,
					type: "backup",
					account: null,
					dryRun: false,
					runnerJobId: randomUUID(),
					triggeredByUserId: user.id,
				});

			const a1 = await seed(depA.id);
			await new Promise((r) => setTimeout(r, 10));
			const a2 = await seed(depA.id);
			await new Promise((r) => setTimeout(r, 10));
			const a3 = await seed(depA.id);
			await seed(depB.id); // foreign deployment, must not appear

			const page1 = await listMigrationJobs({
				deploymentId: depA.id,
				limit: 2,
				offset: 0,
			});
			expect(page1.map((j) => j.id)).toEqual([a3.id, a2.id]);

			const page2 = await listMigrationJobs({
				deploymentId: depA.id,
				limit: 2,
				offset: 2,
			});
			expect(page2.map((j) => j.id)).toEqual([a1.id]);
		});
	});

	describe("getActiveMigrationJob", () => {
		it("returns null when deployment has no jobs", async () => {
			const deployment = await createTestDeployment();
			const result = await getActiveMigrationJob(deployment.id);
			expect(result).toBeNull();
		});

		it("ignores done/failed jobs and returns the running one", async () => {
			const deployment = await createTestDeployment();
			const user = await createTestUser();
			const seed = (status: "done" | "failed" | "running") =>
				createMigrationJob({
					deploymentId: deployment.id,
					type: "backup",
					account: null,
					dryRun: false,
					runnerJobId: randomUUID(),
					triggeredByUserId: user.id,
				}).then(async (j) => {
					await updateMigrationJobStatus(j.id, { status, exitCode: status === "done" ? 0 : null });
					return j;
				});
			await seed("done");
			await seed("failed");
			const running = await seed("running");

			const result = await getActiveMigrationJob(deployment.id);
			expect(result?.id).toBe(running.id);
			expect(result?.status).toBe("running");
		});

		it("returns the queued job", async () => {
			const deployment = await createTestDeployment();
			const user = await createTestUser();
			const job = await createMigrationJob({
				deploymentId: deployment.id,
				type: "backup",
				account: null,
				dryRun: false,
				runnerJobId: randomUUID(),
				triggeredByUserId: user.id,
			});
			const result = await getActiveMigrationJob(deployment.id);
			expect(result?.id).toBe(job.id);
			expect(result?.status).toBe("queued");
		});

		it("does not leak jobs from other deployments", async () => {
			const depA = await createTestDeployment();
			const depB = await createTestDeployment();
			const user = await createTestUser();
			await createMigrationJob({
				deploymentId: depA.id,
				type: "backup",
				account: null,
				dryRun: false,
				runnerJobId: randomUUID(),
				triggeredByUserId: user.id,
			});

			const result = await getActiveMigrationJob(depB.id);
			expect(result).toBeNull();
		});
	});
});
