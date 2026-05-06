import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/database/setup";
import {
	decryptServerConfig,
	encryptServerConfig,
} from "@/encryption/server-config";
import { generateEncryptionKey } from "@/encryption/index";
import { createTestDeployment } from "@/test/fixtures";
import {
	getDeploymentServerConfig,
	setDeploymentServerConfig,
} from "./queries";
import { deployments } from "./table";

describe("getDeploymentServerConfig (integration)", () => {
	it("returns null when deployment has no server_config set", async () => {
		const deployment = await createTestDeployment();
		const result = await getDeploymentServerConfig(deployment.id);
		expect(result).toBeNull();
	});

	it("returns the persisted server_config when set", async () => {
		const deployment = await createTestDeployment();
		const config = {
			backup_path: "client",
			bwlimit: "08:00,5M",
			runner_url: "https://runner.example.com",
		};
		await getDb()
			.update(deployments)
			.set({ serverConfig: config })
			.where(eq(deployments.id, deployment.id));

		const result = await getDeploymentServerConfig(deployment.id);
		expect(result).toEqual(config);
	});

	it("returns null when deployment id does not exist", async () => {
		const result = await getDeploymentServerConfig(
			"00000000-0000-4000-8000-000000000000",
		);
		expect(result).toBeNull();
	});
});

describe("setDeploymentServerConfig + encryption roundtrip (integration)", () => {
	it("persists encrypted runner_token and decrypts on read", async () => {
		const deployment = await createTestDeployment();
		const key = generateEncryptionKey();
		const original = {
			backup_path: "client",
			bwlimit: "08:00,5M",
			runner_url: "https://runner.example.com",
			runner_token: "live-token-xyz",
		};

		const encrypted = await encryptServerConfig(original, key);
		await setDeploymentServerConfig(deployment.id, encrypted);

		const stored = await getDeploymentServerConfig(deployment.id);
		expect(stored?.runner_token).not.toBe("live-token-xyz");
		expect(stored?.runner_token).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);

		const decrypted = stored ? await decryptServerConfig(stored, key) : null;
		expect(decrypted).toEqual(original);
	});
});
