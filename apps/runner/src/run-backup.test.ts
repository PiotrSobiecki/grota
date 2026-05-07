import type { LogLine, RunnerJobConfig } from "@repo/data-ops/migration";
import { describe, expect, it, vi } from "vitest";
import { buildRcloneSyncArgs, createRunBackup, type SpawnRcloneFn } from "./run-backup";

const baseConfig: RunnerJobConfig = {
	b2KeyId: "K001abc",
	b2AppKey: "supersecret",
	bucketPrefix: "client-x",
	backupPath: "/var/backups/grota",
};

describe("buildRcloneSyncArgs", () => {
	it("produces sync args from backupPath to b2:bucketPrefix", () => {
		const args = buildRcloneSyncArgs(baseConfig);
		expect(args).toContain("sync");
		expect(args).toContain("/var/backups/grota");
		expect(args).toContain("b2:client-x");
		expect(args).toContain("--config");
	});

	it("appends --bwlimit when bwlimit is set", () => {
		const args = buildRcloneSyncArgs({ ...baseConfig, bwlimit: "10M" });
		const idx = args.indexOf("--bwlimit");
		expect(idx).toBeGreaterThan(-1);
		expect(args[idx + 1]).toBe("10M");
	});

	it("omits --bwlimit when not set", () => {
		const args = buildRcloneSyncArgs(baseConfig);
		expect(args).not.toContain("--bwlimit");
	});

	it("includes -v so transfers and skips show up in logs", () => {
		const args = buildRcloneSyncArgs(baseConfig);
		expect(args).toContain("-v");
	});
});

describe("createRunBackup", () => {
	it("returns exit 1 and emits stderr log when runnerConfig is missing", async () => {
		const spawn: SpawnRcloneFn = vi.fn();
		const run = createRunBackup(spawn);
		const logs: LogLine[] = [];
		const exit = await run("job-1", {}, (l) => logs.push(l));
		expect(exit).toBe(1);
		expect(spawn).not.toHaveBeenCalled();
		expect(logs).toHaveLength(1);
		expect(logs[0]?.stream).toBe("stderr");
		expect(logs[0]?.line).toMatch(/runnerConfig/i);
	});

	it("calls spawnRclone with built config and forwards exitCode", async () => {
		let capturedArgs: string[] = [];
		let capturedConfig = "";
		const spawn: SpawnRcloneFn = vi.fn(async (args, opts) => {
			capturedArgs = args;
			capturedConfig = opts.configContent;
			return 0;
		});
		const run = createRunBackup(spawn);
		const exit = await run("job-1", { runnerConfig: baseConfig }, () => {});
		expect(exit).toBe(0);
		expect(capturedArgs).toContain("sync");
		expect(capturedArgs).toContain("b2:client-x");
		expect(capturedConfig).toContain("[b2]");
		expect(capturedConfig).toMatch(/account\s*=\s*K001abc/);
		expect(capturedConfig).toMatch(/key\s*=\s*supersecret/);
	});

	it("forwards onLog from spawnRclone", async () => {
		const spawn: SpawnRcloneFn = vi.fn(async (_args, opts) => {
			opts.onLog({
				ts: "2026-05-06T10:00:00.000Z",
				stream: "stdout",
				line: "Transferred: 1 / 1, 100%",
			});
			return 0;
		});
		const run = createRunBackup(spawn);
		const logs: LogLine[] = [];
		await run("job-1", { runnerConfig: baseConfig }, (l) => logs.push(l));
		expect(logs).toHaveLength(1);
		expect(logs[0]?.line).toContain("Transferred");
	});

	it("propagates non-zero exitCode from spawnRclone", async () => {
		const spawn: SpawnRcloneFn = vi.fn(async () => 7);
		const run = createRunBackup(spawn);
		const exit = await run("job-1", { runnerConfig: baseConfig }, () => {});
		expect(exit).toBe(7);
	});
});
