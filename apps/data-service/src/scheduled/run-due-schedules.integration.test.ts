import { randomUUID } from "node:crypto";
import { setDeploymentServerConfig, updateDeployment } from "@repo/data-ops/deployment";
import { encryptServerConfig } from "@repo/data-ops/encryption";
import { listMigrationJobs } from "@repo/data-ops/migration";
import { getSchedule, setScheduleEnabled } from "@repo/data-ops/schedule";
import { createTestDeployment } from "@repo/data-ops/test-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDueSchedules } from "./run-due-schedules";

function encryptionKey(): string {
	const key = process.env.ENCRYPTION_KEY;
	if (!key) throw new Error("ENCRYPTION_KEY not set");
	return key;
}

async function setupReadyDeployment(): Promise<string> {
	const deployment = await createTestDeployment();
	await updateDeployment(deployment.id, {
		b2Config: { key_id: "K001abcd", app_key: "K001secret", bucket_prefix: "test" },
	});
	await setDeploymentServerConfig(
		deployment.id,
		await encryptServerConfig(
			{
				backup_path: "client",
				bwlimit: "08:00,5M",
				runner_url: "https://runner.example.com",
				runner_token: "secret-token",
			},
			encryptionKey(),
		),
	);
	return deployment.id;
}

describe("runDueSchedules (integration)", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});
	afterEach(() => {
		fetchSpy.mockRestore();
	});

	function mockRunnerAccept(jobId: string) {
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.startsWith("https://runner.example.com")) {
				return new Response(JSON.stringify({ jobId }), {
					status: 202,
					headers: { "content-type": "application/json" },
				});
			}
			return originalFetch(input, init);
		});
	}

	it("triggers backup for due schedules, persists migration_jobs row, advances next_run_at", async () => {
		const deploymentId = await setupReadyDeployment();
		await setScheduleEnabled(deploymentId, true);
		mockRunnerAccept(randomUUID());

		const now = new Date();
		const result = await runDueSchedules({ encryptionKey: encryptionKey() }, now);

		expect(result.attempted).toBe(1);
		expect(result.succeeded).toBe(1);
		expect(result.failed).toBe(0);

		const jobs = await listMigrationJobs({ deploymentId, limit: 10, offset: 0 });
		expect(jobs.length).toBe(1);
		expect(jobs[0]?.type).toBe("backup");

		const schedule = await getSchedule(deploymentId);
		if (!schedule) throw new Error("schedule missing");
		expect(schedule.lastRunAt?.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1000);
		// next_run_at advanced by 24h (default interval)
		const expectedNext = now.getTime() + 24 * 60 * 60 * 1000;
		expect(schedule.nextRunAt?.getTime()).toBeGreaterThanOrEqual(expectedNext - 1000);
		expect(schedule.nextRunAt?.getTime()).toBeLessThanOrEqual(expectedNext + 1000);
	});

	it("skips disabled schedules", async () => {
		const deploymentId = await setupReadyDeployment();
		await setScheduleEnabled(deploymentId, true);
		await setScheduleEnabled(deploymentId, false);
		mockRunnerAccept(randomUUID());

		const result = await runDueSchedules({ encryptionKey: encryptionKey() }, new Date());

		expect(result.attempted).toBe(0);
		const jobs = await listMigrationJobs({ deploymentId, limit: 10, offset: 0 });
		expect(jobs.length).toBe(0);
	});

	it("counts schedule as failed when runner config is missing, leaves next_run_at untouched", async () => {
		const deployment = await createTestDeployment();
		await setScheduleEnabled(deployment.id, true);
		const before = await getSchedule(deployment.id);

		const result = await runDueSchedules({ encryptionKey: encryptionKey() }, new Date());

		expect(result.attempted).toBe(1);
		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(1);

		const after = await getSchedule(deployment.id);
		expect(after?.nextRunAt?.getTime()).toBe(before?.nextRunAt?.getTime());
	});
});
