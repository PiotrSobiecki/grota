import { describe, expect, it } from "vitest";
import type { B2Config } from "@/deployment/schema";
import { decryptB2Config, encryptB2Config } from "./b2-config";
import { generateEncryptionKey } from "./index";

describe("encryptB2Config / decryptB2Config", () => {
	it("encrypts only app_key, leaves key_id and bucket_prefix plaintext", async () => {
		const key = await generateEncryptionKey();
		const config: B2Config = {
			key_id: "K001abc",
			app_key: "supersecret",
			bucket_prefix: "client-x",
		};
		const encrypted = await encryptB2Config(config, key);
		expect(encrypted.key_id).toBe("K001abc");
		expect(encrypted.bucket_prefix).toBe("client-x");
		expect(encrypted.app_key).not.toBe("supersecret");
		expect(encrypted.app_key).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
	});

	it("roundtrip: decrypt(encrypt(x)) === x", async () => {
		const key = await generateEncryptionKey();
		const config: B2Config = {
			key_id: "K001abc",
			app_key: "supersecret",
			bucket_prefix: "client-x",
		};
		const encrypted = await encryptB2Config(config, key);
		const decrypted = await decryptB2Config(encrypted, key);
		expect(decrypted).toEqual(config);
	});

	it("encryptB2Config is a no-op when app_key is missing or empty", async () => {
		const key = await generateEncryptionKey();
		const config = { key_id: "K001", app_key: "", bucket_prefix: "x" } as B2Config;
		const encrypted = await encryptB2Config(config, key);
		expect(encrypted.app_key).toBe("");
	});

	it("decryptB2Config: passthrough plaintext (legacy rows without `iv:cipher` format)", async () => {
		const key = await generateEncryptionKey();
		const legacy: B2Config = {
			key_id: "K001",
			app_key: "plaintext-legacy",
			bucket_prefix: "x",
		};
		const decrypted = await decryptB2Config(legacy, key);
		expect(decrypted.app_key).toBe("plaintext-legacy");
	});
});
