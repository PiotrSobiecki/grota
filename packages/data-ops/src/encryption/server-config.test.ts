import { beforeAll, describe, expect, it } from "vitest";
import { decryptServerConfig, encryptServerConfig } from "./server-config";
import { generateEncryptionKey } from "./index";

let key: string;
beforeAll(() => {
	key = generateEncryptionKey();
});

describe("encryptServerConfig", () => {
	it("replaces runner_token with ciphertext", async () => {
		const result = await encryptServerConfig(
			{ backup_path: "client", bwlimit: "08:00,5M", runner_token: "secret" },
			key,
		);
		expect(result.runner_token).not.toBe("secret");
		expect(result.runner_token).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
	});

	it("preserves non-secret fields untouched", async () => {
		const input = {
			backup_path: "client",
			bwlimit: "08:00,5M",
			runner_url: "https://runner.example.com",
			runner_token: "secret",
		};
		const result = await encryptServerConfig(input, key);
		expect(result.backup_path).toBe("client");
		expect(result.bwlimit).toBe("08:00,5M");
		expect(result.runner_url).toBe("https://runner.example.com");
	});

	it("returns config unchanged when runner_token is absent", async () => {
		const input = { backup_path: "client", bwlimit: "08:00,5M" };
		const result = await encryptServerConfig(input, key);
		expect(result).toEqual(input);
	});
});

describe("encrypt/decrypt roundtrip", () => {
	it("decryptServerConfig restores the original runner_token", async () => {
		const original = {
			backup_path: "client",
			bwlimit: "08:00,5M",
			runner_token: "super-secret-token",
		};
		const encrypted = await encryptServerConfig(original, key);
		const decrypted = await decryptServerConfig(encrypted, key);
		expect(decrypted.runner_token).toBe("super-secret-token");
	});
});
