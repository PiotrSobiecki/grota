import { randomUUID } from "node:crypto";
import {
	type ServerConfig,
	setDeploymentServerConfig,
	updateDeployment,
} from "@repo/data-ops/deployment";
import { encryptServerConfig } from "@repo/data-ops/encryption";
import {
	createMigrationJob,
	getMigrationJob,
	updateMigrationJobStatus,
} from "@repo/data-ops/migration";
import {
	createTestDeployment,
	createTestUser,
} from "@repo/data-ops/test-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerBackup } from "./migration-service";

const fullConfig: ServerConfig = {
	backup_path: "client",
	bwlimit: "08:00,5M",
	runner_url: "https://runner.example.com",
	runner_token: "secret-token",
};

function encryptionKey(): string {
	const key = process.env.ENCRYPTION_KEY;
	if (!key) throw new Error("ENCRYPTION_KEY not set");
	return key;
}

async function setB2Config(deploymentId: string): Promise<void> {
	await updateDeployment(deploymentId, {
		b2Config: {
			key_id: "K001abcdefgh",
			app_key: "K001secretappkey",
			bucket_prefix: "test",
		},
	});
}

async function setupReadyDeployment(): Promise<string> {
	const deployment = await createTestDeployment();
	await setB2Config(deployment.id);
	await setDeploymentServerConfig(
		deployment.id,
		await encryptServerConfig(fullConfig, encryptionKey()),
	);
	return deployment.id;
}

describe("triggerBackup (integration)", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});
	afterEach(() => {
		fetchSpy.mockRestore();
	});

	function mockRunnerJobAccept(jobId: string) {
		fetchSpy.mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.startsWith("https://runner.example.com")) {
					return new Response(JSON.stringify({ jobId }), {
						status: 202,
						headers: { "content-type": "application/json" },
					});
				}
				return originalFetch(input, init);
			},
		);
	}

	it("returns NOT_FOUND for unknown deployment", async () => {
		const user = await createTestUser();
		const result = await triggerBackup({
			deploymentId: "00000000-0000-4000-8000-000000000000",
			triggeredByUserId: user.id,
			encryptionKey: encryptionKey(),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
	});

	it("returns CONFIG_INCOMPLETE when runner config is missing", async () => {
		const deployment = await createTestDeployment();
		await setB2Config(deployment.id);
		const user = await createTestUser();
		const result = await triggerBackup({
			deploymentId: deployment.id,
			triggeredByUserId: user.id,
			encryptionKey: encryptionKey(),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("CONFIG_INCOMPLETE");
	});

	it("posts to runner /jobs/backup with bearer token, persists migration_jobs row, returns it", async () => {
		const deploymentId = await setupReadyDeployment();
		const user = await createTestUser();
		const runnerJobId = randomUUID();
		mockRunnerJobAccept(runnerJobId);

		const result = await triggerBackup({
			deploymentId,
			account: "user@example.com",
			triggeredByUserId: user.id,
			encryptionKey: encryptionKey(),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.runnerJobId).toBe(runnerJobId);
		expect(result.data.deploymentId).toBe(deploymentId);
		expect(result.data.type).toBe("backup");
		expect(result.data.account).toBe("user@example.com");
		expect(result.data.triggeredByUserId).toBe(user.id);

		const persisted = await getMigrationJob(result.data.id);
		expect(persisted?.runnerJobId).toBe(runnerJobId);

		const calls = (
			fetchSpy.mock.calls as unknown as [RequestInfo | URL, RequestInit?][]
		).filter((args) => {
			const u = args[0];
			const url = typeof u === "string" ? u : u.toString();
			return url.startsWith("https://runner.example.com");
		});
		expect(calls).toHaveLength(1);
		const first = calls[0];
		if (!first) throw new Error("no call");
		const [url, init] = first;
		const urlStr = typeof url === "string" ? url : url.toString();
		expect(urlStr).toBe("https://runner.example.com/jobs/backup");
		expect(init?.method).toBe("POST");
		const headers = new Headers(init?.headers);
		expect(headers.get("authorization")).toBe("Bearer secret-token");
		expect(headers.get("content-type")).toBe("application/json");
		const body = JSON.parse(init?.body as string);
		expect(body.account).toBe("user@example.com");
		expect(body.runnerConfig).toEqual({
			b2KeyId: "K001abcdefgh",
			b2AppKey: "K001secretappkey",
			bucketPrefix: "test",
			backupPath: "client",
			bwlimit: "08:00,5M",
		});
	});

	it("returns CONFIG_INCOMPLETE when B2 config is missing", async () => {
		const deployment = await createTestDeployment();
		await setDeploymentServerConfig(
			deployment.id,
			await encryptServerConfig(fullConfig, encryptionKey()),
		);
		const user = await createTestUser();
		const result = await triggerBackup({
			deploymentId: deployment.id,
			triggeredByUserId: user.id,
			encryptionKey: encryptionKey(),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("CONFIG_INCOMPLETE");
	});

	it("returns RUNNER_UNREACHABLE on fetch network error", async () => {
		const deploymentId = await setupReadyDeployment();
		const user = await createTestUser();
		fetchSpy.mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.startsWith("https://runner.example.com")) {
					throw new TypeError("fetch failed");
				}
				return originalFetch(input, init);
			},
		);

		const result = await triggerBackup({
			deploymentId,
			triggeredByUserId: user.id,
			encryptionKey: encryptionKey(),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("RUNNER_UNREACHABLE");
	});

	it("returns RUNNER_REJECTED when runner responds with non-2xx status", async () => {
		const deploymentId = await setupReadyDeployment();
		const user = await createTestUser();
		fetchSpy.mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.startsWith("https://runner.example.com")) {
					return new Response(JSON.stringify({ error: "job_already_running" }), {
						status: 409,
						headers: { "content-type": "application/json" },
					});
				}
				return originalFetch(input, init);
			},
		);

		const result = await triggerBackup({
			deploymentId,
			triggeredByUserId: user.id,
			encryptionKey: encryptionKey(),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("RUNNER_REJECTED");
	});

	it("returns JOB_ALREADY_RUNNING when an active job exists, does not call the runner", async () => {
		const deploymentId = await setupReadyDeployment();
		const user = await createTestUser();
		await createMigrationJob({
			deploymentId,
			type: "backup",
			account: null,
			dryRun: false,
			runnerJobId: randomUUID(),
			triggeredByUserId: user.id,
		});
		const runnerCalls: string[] = [];
		fetchSpy.mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.startsWith("https://runner.example.com")) {
					runnerCalls.push(url);
					throw new Error("runner must not be called");
				}
				return originalFetch(input, init);
			},
		);

		const result = await triggerBackup({
			deploymentId,
			triggeredByUserId: user.id,
			encryptionKey: encryptionKey(),
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("JOB_ALREADY_RUNNING");
		expect(runnerCalls).toEqual([]);
	});

	it("proceeds when the only prior job is in a terminal state", async () => {
		const deploymentId = await setupReadyDeployment();
		const user = await createTestUser();
		const prior = await createMigrationJob({
			deploymentId,
			type: "backup",
			account: null,
			dryRun: false,
			runnerJobId: randomUUID(),
			triggeredByUserId: user.id,
		});
		await updateMigrationJobStatus(prior.id, { status: "failed", exitCode: 1 });
		mockRunnerJobAccept(randomUUID());

		const result = await triggerBackup({
			deploymentId,
			triggeredByUserId: user.id,
			encryptionKey: encryptionKey(),
		});

		expect(result.ok).toBe(true);
	});
});
