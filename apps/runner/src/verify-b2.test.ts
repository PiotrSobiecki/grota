import { describe, expect, it, vi } from "vitest";
import { buildRcloneConfig, createVerifyB2 } from "./verify-b2";

describe("buildRcloneConfig", () => {
	it("produces a valid rclone.conf with [b2] section and credentials", () => {
		const conf = buildRcloneConfig({
			b2KeyId: "K001abc",
			b2AppKey: "secret123",
			bucketPrefix: "client-x",
		});
		expect(conf).toContain("[b2]");
		expect(conf).toMatch(/type\s*=\s*b2/);
		expect(conf).toMatch(/account\s*=\s*K001abc/);
		expect(conf).toMatch(/key\s*=\s*secret123/);
	});
});

describe("createVerifyB2", () => {
	it("returns ok=true when rclone exits 0", async () => {
		const spawn = vi.fn(async () => ({ exitCode: 0, stderr: "" }));
		const verify = createVerifyB2(spawn);
		const result = await verify({
			b2KeyId: "K001abc",
			b2AppKey: "secret",
			bucketPrefix: "x",
		});
		expect(result.ok).toBe(true);
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("returns ok=false with stderr message when rclone exits non-zero", async () => {
		const spawn = vi.fn(async () => ({
			exitCode: 1,
			stderr: "Failed to authenticate: invalid credentials",
		}));
		const verify = createVerifyB2(spawn);
		const result = await verify({
			b2KeyId: "bad",
			b2AppKey: "bad",
			bucketPrefix: "x",
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain("invalid credentials");
	});

	it("invokes rclone with --config pointing at temp file containing built rclone.conf", async () => {
		let receivedArgs: string[] = [];
		let receivedConfigContent = "";
		const spawn = vi.fn(async (_cmd: string, args: string[], opts: { configContent: string }) => {
			receivedArgs = args;
			receivedConfigContent = opts.configContent;
			return { exitCode: 0, stderr: "" };
		});
		const verify = createVerifyB2(spawn);
		await verify({
			b2KeyId: "K001key",
			b2AppKey: "appkey",
			bucketPrefix: "prefix",
		});
		expect(receivedArgs).toContain("--config");
		expect(receivedArgs).toContain("lsd");
		expect(receivedArgs).toContain("b2:");
		expect(receivedConfigContent).toContain("[b2]");
		expect(receivedConfigContent).toMatch(/account\s*=\s*K001key/);
	});
});
