import { describe, expect, it } from "vitest";
import { sanitizeLogLine } from "./sanitize-log";

describe("sanitizeLogLine", () => {
	it("passes through plain log lines unchanged", () => {
		expect(sanitizeLogLine("Transferred: 12 / 100, 12%")).toBe(
			"Transferred: 12 / 100, 12%",
		);
	});

	it("masks Bearer tokens in Authorization-style strings", () => {
		const out = sanitizeLogLine("authorization: Bearer abc123secret");
		expect(out).not.toContain("abc123secret");
		expect(out).toMatch(/Bearer \*+/);
	});

	it("masks rclone account=... key=... in config dumps", () => {
		const out = sanitizeLogLine("account = K001abc, key = supersecret");
		expect(out).not.toContain("K001abc");
		expect(out).not.toContain("supersecret");
		expect(out).toMatch(/account\s*=\s*\*+/);
		expect(out).toMatch(/key\s*=\s*\*+/);
	});

	it("masks app_key= in URL-style query strings", () => {
		const out = sanitizeLogLine("https://api.example.com/x?app_key=verysecret&foo=bar");
		expect(out).not.toContain("verysecret");
		expect(out).toContain("foo=bar");
	});

	it("masks refresh_token= and access_token= in JSON-ish output", () => {
		const out = sanitizeLogLine('{"refresh_token":"r3fresh","access_token":"a3cess"}');
		expect(out).not.toContain("r3fresh");
		expect(out).not.toContain("a3cess");
	});

	it("masks GROTA_TOKEN-style env exposure", () => {
		const out = sanitizeLogLine("GROTA_TOKEN=sup3rs3cr3t starting up");
		expect(out).not.toContain("sup3rs3cr3t");
		expect(out).toContain("starting up");
	});
});
