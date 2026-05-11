import { setDeploymentServerConfig, updateDeployment } from "@repo/data-ops/deployment";
import { encryptServerConfig } from "@repo/data-ops/encryption";
import { listMigrationJobs } from "@repo/data-ops/migration";
import { getSchedule, setSchedule } from "@repo/data-ops/schedule";
import { createTestDeployment } from "@repo/data-ops/test-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDueSchedules } from "./run-due-schedules";

function encryptionKey(): string {
	const key = process.env.ENCRYPTION_KEY;
	if (!key) throw new Error("ENCRYPTION_KEY not set");
	return key;
}

function envForTest(): Env {
	return { ENCRYPTION_KEY: encryptionKey() } as Env;
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

	it("fails with NO_EMPLOYEES when deployment has runner config but no employees, leaves next_run_at untouched", async () => {
		const deploymentId = await setupReadyDeployment();
		await setSchedule(deploymentId, { enabled: true, intervalHours: 24, anchorTime: "02:00" });
		const before = await getSchedule(deploymentId);

		const result = await runDueSchedules(envForTest(), new Date());

		expect(result.attempted).toBe(1);
		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(1);

		const jobs = await listMigrationJobs({ deploymentId, limit: 10, offset: 0 });
		expect(jobs.length).toBe(0);

		const after = await getSchedule(deploymentId);
		expect(after?.nextRunAt?.getTime()).toBe(before?.nextRunAt?.getTime());
	});

	it("skips disabled schedules", async () => {
		const deploymentId = await setupReadyDeployment();
		await setSchedule(deploymentId, { enabled: true, intervalHours: 24, anchorTime: "02:00" });
		await setSchedule(deploymentId, { enabled: false, intervalHours: 24, anchorTime: "02:00" });

		const result = await runDueSchedules(envForTest(), new Date());

		expect(result.attempted).toBe(0);
		const jobs = await listMigrationJobs({ deploymentId, limit: 10, offset: 0 });
		expect(jobs.length).toBe(0);
	});

	it("counts schedule as failed when runner config is missing, leaves next_run_at untouched", async () => {
		const deployment = await createTestDeployment();
		await setSchedule(deployment.id, { enabled: true, intervalHours: 24, anchorTime: "02:00" });
		const before = await getSchedule(deployment.id);

		const result = await runDueSchedules(envForTest(), new Date());

		expect(result.attempted).toBe(1);
		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(1);

		const after = await getSchedule(deployment.id);
		expect(after?.nextRunAt?.getTime()).toBe(before?.nextRunAt?.getTime());
	});
});
