import { getServerConfigAuditLog } from "@repo/data-ops/audit-log";
import {
	getDeploymentServerConfig,
	type ServerConfig,
	setDeploymentServerConfig,
} from "@repo/data-ops/deployment";
import { decryptServerConfig, encryptServerConfig } from "@repo/data-ops/encryption";
import { createTestDeployment, createTestUser } from "@repo/data-ops/test-fixtures";
import { describe, expect, it } from "vitest";
import { getServerConfigForAdmin, setServerConfigFromAdmin } from "./migration-service";

describe("getServerConfigForAdmin (integration)", () => {
	it("returns null data when deployment has no server_config", async () => {
		const deployment = await createTestDeployment();
		const result = await getServerConfigForAdmin(deployment.id, encryptionKey());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toBeNull();
		}
	});

	it("returns 404 NOT_FOUND for unknown deployment id", async () => {
		const result = await getServerConfigForAdmin(
			"00000000-0000-4000-8000-000000000000",
			encryptionKey(),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("NOT_FOUND");
			expect(result.error.status).toBe(404);
		}
	});

	it("masks runner_token in the response (decrypted then masked, never exposes plaintext)", async () => {
		const deployment = await createTestDeployment();
		const key = encryptionKey();
		const config: ServerConfig = {
			backup_path: "client",
			bwlimit: "08:00,5M",
			runner_url: "https://runner.example.com",
			runner_token: "super-long-secret-runner-token",
		};
		const encrypted = await encryptServerConfig(config, key);
		await setDeploymentServerConfig(deployment.id, encrypted);

		const result = await getServerConfigForAdmin(deployment.id, key);
		expect(result.ok).toBe(true);
		if (result.ok && result.data) {
			expect(result.data.runner_token).not.toBe("super-long-secret-runner-token");
			expect(result.data.runner_token).toMatch(/^.{4}\*{4}.{4}$/);
			expect(result.data.backup_path).toBe("client");
			expect(result.data.runner_url).toBe("https://runner.example.com");
		}
	});
});

describe("setServerConfigFromAdmin (integration)", () => {
	it("returns NOT_FOUND for unknown deployment id", async () => {
		const result = await setServerConfigFromAdmin(
			"00000000-0000-4000-8000-000000000000",
			{ backup_path: "client", bwlimit: "08:00,5M" },
			encryptionKey(),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("NOT_FOUND");
		}
	});

	it("persists a fresh config and encrypts runner_token", async () => {
		const deployment = await createTestDeployment();
		const result = await setServerConfigFromAdmin(
			deployment.id,
			{
				backup_path: "client",
				bwlimit: "08:00,5M",
				runner_url: "https://runner.example.com",
				runner_token: "live-token-xyz",
			},
			encryptionKey(),
		);
		expect(result.ok).toBe(true);

		const stored = await getDeploymentServerConfig(deployment.id);
		expect(stored?.runner_token).not.toBe("live-token-xyz");
		expect(stored?.runner_token).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);

		const decrypted = stored ? await decryptServerConfig(stored, encryptionKey()) : null;
		expect(decrypted?.runner_token).toBe("live-token-xyz");
	});

	it("merges partial update with existing config (untouched fields preserved)", async () => {
		const deployment = await createTestDeployment();
		const initial: ServerConfig = {
			backup_path: "client",
			bwlimit: "08:00,5M",
			runner_url: "https://runner.example.com",
			runner_token: "original-token",
		};
		await setDeploymentServerConfig(
			deployment.id,
			await encryptServerConfig(initial, encryptionKey()),
		);

		const result = await setServerConfigFromAdmin(
			deployment.id,
			{ bwlimit: "23:00,50M" },
			encryptionKey(),
		);
		expect(result.ok).toBe(true);

		const stored = await getDeploymentServerConfig(deployment.id);
		const decrypted = stored ? await decryptServerConfig(stored, encryptionKey()) : null;
		expect(decrypted?.bwlimit).toBe("23:00,50M");
		expect(decrypted?.backup_path).toBe("client");
		expect(decrypted?.runner_url).toBe("https://runner.example.com");
		expect(decrypted?.runner_token).toBe("original-token");
	});

	it("records an audit entry naming the fields that actually changed", async () => {
		const deployment = await createTestDeployment();
		const user = await createTestUser();
		const initial: ServerConfig = {
			backup_path: "client",
			bwlimit: "08:00,5M",
			runner_url: "https://runner.example.com",
			runner_token: "original-token",
		};
		await setDeploymentServerConfig(
			deployment.id,
			await encryptServerConfig(initial, encryptionKey()),
		);

		const result = await setServerConfigFromAdmin(
			deployment.id,
			{ bwlimit: "23:00,50M", runner_token: "rotated-token" },
			encryptionKey(),
			user.id,
		);
		expect(result.ok).toBe(true);

		const log = await getServerConfigAuditLog(deployment.id);
		expect(log).toHaveLength(1);
		expect(log[0]?.userId).toBe(user.id);
		expect(log[0]?.changedFields.sort()).toEqual(["bwlimit", "runner_token"]);
	});
});

function encryptionKey(): string {
	const key = process.env.ENCRYPTION_KEY;
	if (!key) throw new Error("ENCRYPTION_KEY not set");
	return key;
}
