import { describe, expect, it } from "vitest";
import { ServerConfigSchema } from "./schema";

describe("ServerConfigSchema", () => {
	it("rejects bwlimit with invalid format", () => {
		const result = ServerConfigSchema.safeParse({
			backup_path: "client",
			bwlimit: "25:00,5M",
		});
		expect(result.success).toBe(false);
	});

	it("accepts a config with valid multi-slot bwlimit", () => {
		const result = ServerConfigSchema.safeParse({
			backup_path: "client",
			bwlimit: "08:00,5M 23:00,50M",
		});
		expect(result.success).toBe(true);
	});

	it("attaches the error to the bwlimit field path", () => {
		const result = ServerConfigSchema.safeParse({
			backup_path: "client",
			bwlimit: "garbage",
		});
		if (result.success) throw new Error("expected failure");
		const issue = result.error.issues[0];
		expect(issue?.path).toEqual(["bwlimit"]);
	});

	it("accepts a config with runner_url and runner_token", () => {
		const result = ServerConfigSchema.safeParse({
			backup_path: "client",
			bwlimit: "08:00,5M",
			runner_url: "https://runner.example.com",
			runner_token: "secret-token",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.runner_url).toBe("https://runner.example.com");
			expect(result.data.runner_token).toBe("secret-token");
		}
	});

	it("rejects a malformed runner_url", () => {
		const result = ServerConfigSchema.safeParse({
			backup_path: "client",
			bwlimit: "08:00,5M",
			runner_url: "not-a-url",
			runner_token: "secret-token",
		});
		expect(result.success).toBe(false);
	});

	it("rejects an empty runner_token", () => {
		const result = ServerConfigSchema.safeParse({
			backup_path: "client",
			bwlimit: "08:00,5M",
			runner_token: "",
		});
		expect(result.success).toBe(false);
	});

	it("accepts config without runner fields (backward compat)", () => {
		const result = ServerConfigSchema.safeParse({
			backup_path: "client",
			bwlimit: "08:00,5M",
		});
		expect(result.success).toBe(true);
	});
});
