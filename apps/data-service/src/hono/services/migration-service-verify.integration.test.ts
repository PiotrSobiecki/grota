import {
	setDeploymentServerConfig,
	updateDeployment,
	type ServerConfig,
} from "@repo/data-ops/deployment";
import { encryptServerConfig } from "@repo/data-ops/encryption";
import { createTestDeployment } from "@repo/data-ops/test-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testRunnerConnection } from "./migration-service";

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

describe("testRunnerConnection (integration)", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});
	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it("returns NOT_FOUND for unknown deployment", async () => {
		const result = await testRunnerConnection(
			"00000000-0000-4000-8000-000000000000",
			encryptionKey(),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("NOT_FOUND");
		}
	});

	it("returns CONFIG_INCOMPLETE when runner_url is missing", async () => {
		const deployment = await createTestDeployment();
		await setB2Config(deployment.id);
		await setDeploymentServerConfig(
			deployment.id,
			await encryptServerConfig(
				{ backup_path: "client", bwlimit: "08:00,5M" },
				encryptionKey(),
			),
		);
		const result = await testRunnerConnection(deployment.id, encryptionKey());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("CONFIG_INCOMPLETE");
		}
	});

	async function setupReadyDeployment(): Promise<string> {
		const deployment = await createTestDeployment();
		await setB2Config(deployment.id);
		await setDeploymentServerConfig(
			deployment.id,
			await encryptServerConfig(fullConfig, encryptionKey()),
		);
		return deployment.id;
	}

	function mockRunnerFetch(response: { ok: boolean; error?: string }, status = 200) {
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.startsWith("https://runner.example.com")) {
				return new Response(JSON.stringify(response), {
					status,
					headers: { "content-type": "application/json" },
				});
			}
			return originalFetch(input, init);
		});
	}

	it("posts to runner /verify with bearer token and B2 keys, returns ok=true on success", async () => {
		const deploymentId = await setupReadyDeployment();
		mockRunnerFetch({ ok: true });

		const result = await testRunnerConnection(deploymentId, encryptionKey());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.ok).toBe(true);
		}

		const calls = (fetchSpy.mock.calls as unknown as [RequestInfo | URL, RequestInit?][]).filter(
			(args) => {
				const u = args[0];
				const url = typeof u === "string" ? u : u.toString();
				return url.startsWith("https://runner.example.com");
			},
		);
		expect(calls).toHaveLength(1);
		const first = calls[0];
		if (!first) throw new Error("no call");
		const [url, init] = first;
		const urlStr = typeof url === "string" ? url : url.toString();
		expect(urlStr).toBe("https://runner.example.com/verify");
		expect(init?.method).toBe("POST");
		const headers = new Headers(init?.headers);
		expect(headers.get("authorization")).toBe("Bearer secret-token");
		expect(headers.get("content-type")).toBe("application/json");
		const body = JSON.parse(init?.body as string);
		expect(body).toEqual({
			b2KeyId: "K001abcdefgh",
			b2AppKey: "K001secretappkey",
			bucketPrefix: "test",
		});
	});

	it("propagates runner failure as data.ok=false with error message", async () => {
		const deploymentId = await setupReadyDeployment();
		mockRunnerFetch({ ok: false, error: "rclone lsd failed: 401 unauthorized" });

		const result = await testRunnerConnection(deploymentId, encryptionKey());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.ok).toBe(false);
			expect(result.data.error).toContain("401");
		}
	});

	it("returns RUNNER_UNREACHABLE when fetch throws network error", async () => {
		const deploymentId = await setupReadyDeployment();
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.startsWith("https://runner.example.com")) {
				throw new TypeError("fetch failed");
			}
			return originalFetch(input, init);
		});

		const result = await testRunnerConnection(deploymentId, encryptionKey());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("RUNNER_UNREACHABLE");
		}
	});

	it("returns CONFIG_INCOMPLETE when b2 config is missing", async () => {
		const deployment = await createTestDeployment();
		await setDeploymentServerConfig(
			deployment.id,
			await encryptServerConfig(fullConfig, encryptionKey()),
		);
		const result = await testRunnerConnection(deployment.id, encryptionKey());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("CONFIG_INCOMPLETE");
		}
	});
});
