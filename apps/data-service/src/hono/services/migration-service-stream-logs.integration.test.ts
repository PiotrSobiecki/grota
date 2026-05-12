import { randomUUID } from "node:crypto";
import { type ServerConfig, setDeploymentServerConfig } from "@repo/data-ops/deployment";
import { encryptServerConfig } from "@repo/data-ops/encryption";
import { createMigrationJob } from "@repo/data-ops/migration";
import { createTestDeployment, createTestUser } from "@repo/data-ops/test-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamJobLogs } from "./migration-service";

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

async function seedJob(deploymentId: string, runnerJobId?: string) {
	const user = await createTestUser();
	return createMigrationJob({
		deploymentId,
		type: "backup",
		account: null,
		dryRun: false,
		runnerJobId: runnerJobId ?? randomUUID(),
		triggeredByUserId: user.id,
	});
}

describe("streamJobLogs (integration)", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});
	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it("returns NOT_FOUND for unknown job id", async () => {
		const result = await streamJobLogs("00000000-0000-4000-8000-000000000000", encryptionKey());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
	});

	it("returns CONFIG_INCOMPLETE when runner config missing", async () => {
		const deployment = await createTestDeployment();
		const job = await seedJob(deployment.id);
		const result = await streamJobLogs(job.id, encryptionKey());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("CONFIG_INCOMPLETE");
	});

	it("proxies SSE GET to runner with Bearer, forwards upstream response body", async () => {
		const deploymentId = await setupReadyDeployment();
		const runnerJobId = randomUUID();
		const job = await seedJob(deploymentId, runnerJobId);

		const sseBody = `data: {"line":"hello"}\n\ndata: {"line":"world"}\n\n`;
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.startsWith("https://runner.example.com")) {
				return new Response(sseBody, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			}
			return originalFetch(input, init);
		});

		const result = await streamJobLogs(job.id, encryptionKey());
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const calls = (fetchSpy.mock.calls as unknown as [RequestInfo | URL, RequestInit?][]).filter(
			(args) => {
				const u = args[0];
				const url = typeof u === "string" ? u : u.toString();
				return url.startsWith("https://runner.example.com");
			},
		);
		expect(calls).toHaveLength(1);
		const [url, init] = calls[0] ?? [];
		const urlStr = typeof url === "string" ? url : url.toString();
		expect(urlStr).toBe(`https://runner.example.com/jobs/${runnerJobId}/logs/stream`);
		const headers = new Headers(init?.headers);
		expect(headers.get("authorization")).toBe("Bearer secret-token");

		expect(result.data.headers.get("content-type")).toContain("text/event-stream");
		const text = await result.data.text();
		expect(text).toContain('"line":"hello"');
		expect(text).toContain('"line":"world"');
	});

	it("returns RUNNER_UNREACHABLE on network error", async () => {
		const deploymentId = await setupReadyDeployment();
		const job = await seedJob(deploymentId);
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.startsWith("https://runner.example.com")) {
				throw new TypeError("fetch failed");
			}
			return originalFetch(input, init);
		});

		const result = await streamJobLogs(job.id, encryptionKey());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("RUNNER_UNREACHABLE");
	});
});
