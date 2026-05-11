import type { LogLine, RunnerJobConfig } from "@repo/data-ops/migration";
import { describe, expect, it, vi } from "vitest";
import type { SpawnRcloneFn } from "./run-backup";
import { buildRcloneMigrateArgs, createRunMigrate } from "./run-migrate";

const baseConfig: RunnerJobConfig = {
	b2KeyId: "K001abc",
	b2AppKey: "supersecret",
	bucketPrefix: "client-x",
	backupPath: "/var/backups/grota",
};

describe("buildRcloneMigrateArgs", () => {
	it("syncs from b2:bucketPrefix to backupPath", () => {
		const args = buildRcloneMigrateArgs(baseConfig, false);
		expect(args).toContain("sync");
		expect(args).toContain("b2:client-x");
		expect(args).toContain("/var/backups/grota");
		expect(args).not.toContain("--dry-run");
	});

	it("appends --dry-run when dryRun=true", () => {
		const args = buildRcloneMigrateArgs(baseConfig, true);
		expect(args).toContain("--dry-run");
	});

	it("includes -v so transfers and skips show up in logs", () => {
		const args = buildRcloneMigrateArgs(baseConfig, false);
		expect(args).toContain("-v");
	});
});

describe("createRunMigrate", () => {
	it("returns 1 and logs stderr when runnerConfig missing", async () => {
		const spawn: SpawnRcloneFn = vi.fn();
		const run = createRunMigrate(spawn);
		const logs: LogLine[] = [];
		const exit = await run("job-1", { dryRun: false }, (l) => logs.push(l));
		expect(exit).toBe(1);
		expect(spawn).not.toHaveBeenCalled();
		expect(logs[0]?.stream).toBe("stderr");
	});

	it("forwards dryRun=true to args and returns spawn exit code", async () => {
		let captured: string[] = [];
		const spawn: SpawnRcloneFn = vi.fn(async (args) => {
			captured = args;
			return 0;
		});
		const run = createRunMigrate(spawn);
		const exit = await run("job-1", { dryRun: true, runnerConfig: baseConfig }, () => {});
		expect(exit).toBe(0);
		expect(captured).toContain("--dry-run");
	});

	it("propagates non-zero exit from spawnRclone", async () => {
		const spawn: SpawnRcloneFn = vi.fn(async () => 5);
		const run = createRunMigrate(spawn);
		const exit = await run("job-1", { dryRun: false, runnerConfig: baseConfig }, () => {});
		expect(exit).toBe(5);
	});
});
