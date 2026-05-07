import { randomUUID } from "node:crypto";
import {
	type ServerConfig,
	setDeploymentServerConfig,
} from "@repo/data-ops/deployment";
import { encryptServerConfig } from "@repo/data-ops/encryption";
import { createMigrationJob, getMigrationJob } from "@repo/data-ops/migration";
import {
	createTestDeployment,
	createTestUser,
} from "@repo/data-ops/test-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMigrationJobStatus } from "./migration-service";

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

async function setupReadyDeployment(): Promise<string> {
	const deployment = await createTestDeployment();
	await setDeploymentServerConfig(
		deployment.id,
		await encryptServerConfig(fullConfig, encryptionKey()),
	);
	return deployment.id;
}

async function seedJob(opts: {
	deploymentId: string;
	runnerJobId?: string;
}) {
	const user = await createTestUser();
	return createMigrationJob({
		deploymentId: opts.deploymentId,
		type: "backup",
		account: null,
		dryRun: false,
		runnerJobId: opts.runnerJobId ?? randomUUID(),
		triggeredByUserId: user.id,
	});
}

describe("getMigrationJobStatus (integration)", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});
	afterEach(() => {
		fetchSpy.mockRestore();
	});

	function mockRunnerJobStatus(payload: {
		id: string;
		status: "queued" | "running" | "done" | "failed";
		exitCode?: number | null;
	}) {
		fetchSpy.mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.startsWith("https://runner.example.com")) {
					return new Response(
						JSON.stringify({
							id: payload.id,
							status: payload.status,
							startedAt: new Date().toISOString(),
							finishedAt:
								payload.status === "done" || payload.status === "failed"
									? new Date().toISOString()
									: null,
							exitCode: payload.exitCode ?? null,
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				return originalFetch(input, init);
			},
		);
	}

	it("returns NOT_FOUND for unknown job id", async () => {
		const result = await getMigrationJobStatus(
			"00000000-0000-4000-8000-000000000000",
			encryptionKey(),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
	});

	it("returns terminal job from DB without contacting runner", async () => {
		const deploymentId = await setupReadyDeployment();
		const job = await seedJob({ deploymentId });
		// mark terminal directly via runner-side state simulated by query
		const { updateMigrationJobStatus } = await import(
			"@repo/data-ops/migration"
		);
		await updateMigrationJobStatus(job.id, { status: "done", exitCode: 0 });

		const result = await getMigrationJobStatus(job.id, encryptionKey());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.status).toBe("done");
		expect(result.data.exitCode).toBe(0);
		const runnerCalls = (
			fetchSpy.mock.calls as unknown as [RequestInfo | URL, RequestInit?][]
		).filter((args) => {
			const u = args[0];
			const url = typeof u === "string" ? u : u.toString();
			return url.startsWith("https://runner.example.com");
		});
		expect(runnerCalls).toHaveLength(0);
	});

	it("fetches runner for non-terminal job, updates DB when status changes to done", async () => {
		const deploymentId = await setupReadyDeployment();
		const runnerJobId = randomUUID();
		const job = await seedJob({ deploymentId, runnerJobId });
		mockRunnerJobStatus({ id: runnerJobId, status: "done", exitCode: 0 });

		const result = await getMigrationJobStatus(job.id, encryptionKey());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.status).toBe("done");
		expect(result.data.exitCode).toBe(0);
		expect(result.data.finishedAt).toBeInstanceOf(Date);

		const persisted = await getMigrationJob(job.id);
		expect(persisted?.status).toBe("done");
		expect(persisted?.exitCode).toBe(0);

		const runnerCalls = (
			fetchSpy.mock.calls as unknown as [RequestInfo | URL, RequestInit?][]
		).filter((args) => {
			const u = args[0];
			const url = typeof u === "string" ? u : u.toString();
			return url.startsWith("https://runner.example.com");
		});
		expect(runnerCalls).toHaveLength(1);
		const [url, init] = runnerCalls[0]!;
		const urlStr = typeof url === "string" ? url : url.toString();
		expect(urlStr).toBe(`https://runner.example.com/jobs/${runnerJobId}`);
		const headers = new Headers(init?.headers);
		expect(headers.get("authorization")).toBe("Bearer secret-token");
	});

	it("returns stale DB row when runner is unreachable for non-terminal job", async () => {
		const deploymentId = await setupReadyDeployment();
		const job = await seedJob({ deploymentId });
		fetchSpy.mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.startsWith("https://runner.example.com")) {
					throw new TypeError("fetch failed");
				}
				return originalFetch(input, init);
			},
		);

		const result = await getMigrationJobStatus(job.id, encryptionKey());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.id).toBe(job.id);
		expect(result.data.status).toBe("queued");
	});
});
