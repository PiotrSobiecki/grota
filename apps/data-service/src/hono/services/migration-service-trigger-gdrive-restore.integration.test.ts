import { randomUUID } from "node:crypto";
import {
	type ServerConfig,
	setDeploymentServerConfig,
	setWorkspaceOAuthToken,
	updateDeployment,
} from "@repo/data-ops/deployment";
import { encrypt, encryptServerConfig } from "@repo/data-ops/encryption";
import { getMigrationJob } from "@repo/data-ops/migration";
import { upsertSharedDrives } from "@repo/data-ops/shared-drive";
import { createTestDeployment, createTestUser } from "@repo/data-ops/test-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerGDriveRestore } from "./migration-service";

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
	await updateDeployment(deployment.id, {
		b2Config: {
			key_id: "K001abcdefgh",
			app_key: "K001secretappkey",
			bucket_prefix: "test-bucket",
		},
	});
	await setDeploymentServerConfig(
		deployment.id,
		await encryptServerConfig(fullConfig, encryptionKey()),
	);
	const tokenPayload = {
		access_token: "current-access-token",
		refresh_token: "the-refresh-token",
		expiry_date: Date.now() + 60 * 60 * 1000, // 1h future — no refresh needed
	};
	await setWorkspaceOAuthToken(
		deployment.id,
		await encrypt(JSON.stringify(tokenPayload), encryptionKey()),
	);
	await upsertSharedDrives(deployment.id, [
		{ name: "Company SD", googleDriveId: "0ABC-shared-drive-123" },
	]);
	return deployment.id;
}

describe("triggerGDriveRestore (integration)", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});
	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it("posts to runner /jobs/gdrive-restore with workspace token + persists job", async () => {
		const deploymentId = await setupReadyDeployment();
		const user = await createTestUser();
		const runnerJobId = randomUUID();
		let capturedBody: unknown;
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://runner.example.com/jobs/gdrive-restore") {
				capturedBody = JSON.parse(init?.body as string);
				return new Response(JSON.stringify({ jobId: runnerJobId }), {
					status: 202,
					headers: { "content-type": "application/json" },
				});
			}
			return originalFetch(input, init);
		});

		const result = await triggerGDriveRestore({
			deploymentId,
			account: "user@example.com",
			triggeredByUserId: user.id,
			env: {
				ENCRYPTION_KEY: encryptionKey(),
				GOOGLE_CLIENT_ID: "test-client-id",
				GOOGLE_CLIENT_SECRET: "test-client-secret",
			} as unknown as Env,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.data.type).toBe("gdrive-restore");
		expect(result.data.account).toBe("user@example.com");
		expect(result.data.runnerJobId).toBe(runnerJobId);

		const persisted = await getMigrationJob(result.data.id);
		expect(persisted?.type).toBe("gdrive-restore");

		const body = capturedBody as {
			account: string;
			gdrive: { accessToken: string; clientId: string; clientSecret: string };
			runnerConfig: { bucketPrefix: string };
		};
		expect(body.account).toBe("user@example.com");
		expect(body.gdrive.accessToken).toBe("current-access-token");
		expect(body.gdrive.clientId).toBe("test-client-id");
		expect(body.gdrive.clientSecret).toBe("test-client-secret");
		expect(body.runnerConfig.bucketPrefix).toBe("test-bucket");
	});

	it("forwards sharedDriveId from deployment shared_drives to runner so files land on company SD", async () => {
		const deploymentId = await setupReadyDeployment();
		const user = await createTestUser();
		let capturedBody: { gdrive: { sharedDriveId?: string } } | undefined;
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://runner.example.com/jobs/gdrive-restore") {
				capturedBody = JSON.parse(init?.body as string);
				return new Response(JSON.stringify({ jobId: randomUUID() }), {
					status: 202,
					headers: { "content-type": "application/json" },
				});
			}
			return originalFetch(input, init);
		});

		await triggerGDriveRestore({
			deploymentId,
			account: "user@example.com",
			triggeredByUserId: user.id,
			env: {
				ENCRYPTION_KEY: encryptionKey(),
				GOOGLE_CLIENT_ID: "test-client-id",
				GOOGLE_CLIENT_SECRET: "test-client-secret",
			} as unknown as Env,
		});

		expect(capturedBody?.gdrive.sharedDriveId).toBe("0ABC-shared-drive-123");
	});

	it("returns CONFIG_INCOMPLETE when deployment has no shared drive configured", async () => {
		const deployment = await createTestDeployment();
		await updateDeployment(deployment.id, {
			b2Config: {
				key_id: "K001abcdefgh",
				app_key: "K001secretappkey",
				bucket_prefix: "test-bucket",
			},
		});
		await setDeploymentServerConfig(
			deployment.id,
			await encryptServerConfig(fullConfig, encryptionKey()),
		);
		const tokenPayload = {
			access_token: "current-access-token",
			refresh_token: "the-refresh-token",
			expiry_date: Date.now() + 60 * 60 * 1000,
		};
		await setWorkspaceOAuthToken(
			deployment.id,
			await encrypt(JSON.stringify(tokenPayload), encryptionKey()),
		);
		// no shared drives upserted

		const user = await createTestUser();
		const result = await triggerGDriveRestore({
			deploymentId: deployment.id,
			account: "user@example.com",
			triggeredByUserId: user.id,
			env: {
				ENCRYPTION_KEY: encryptionKey(),
				GOOGLE_CLIENT_ID: "test-client-id",
				GOOGLE_CLIENT_SECRET: "test-client-secret",
			} as unknown as Env,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("NO_SHARED_DRIVE");
	});
});
