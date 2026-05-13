import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackupRequest, RunnerJobConfig } from "@repo/data-ops/migration";
import type { LogEmitter, RunBackupFn } from "./app.js";
import { spawnJob } from "./spawn-job.js";

const CONFIG_PLACEHOLDER = "<tmp>";

export type SpawnRcloneFn = (
	args: string[],
	opts: { configContent: string; onLog: LogEmitter },
) => Promise<number>;

export function buildRcloneB2Config(cfg: RunnerJobConfig): string {
	return [
		"[b2]",
		"type = b2",
		`account = ${cfg.b2KeyId}`,
		`key = ${cfg.b2AppKey}`,
		"hard_delete = true",
		"",
	].join("\n");
}

export function buildRcloneSyncArgs(cfg: RunnerJobConfig): string[] {
	const args = [
		"sync",
		cfg.backupPath,
		`b2:${cfg.bucketPrefix}`,
		"--config",
		CONFIG_PLACEHOLDER,
		"--copy-links",
		"-v",
	];
	if (cfg.bwlimit) {
		args.push("--bwlimit", cfg.bwlimit);
	}
	if (cfg.backupIncludeAccounts && cfg.backupIncludeAccounts.length > 0) {
		for (const account of cfg.backupIncludeAccounts) {
			args.push("--include", `${account}/**`);
		}
	}
	return args;
}

export function createRunBackup(spawn: SpawnRcloneFn): RunBackupFn {
	return async (_jobId: string, req: BackupRequest, emitLog: LogEmitter) => {
		const cfg = req.runnerConfig;
		if (!cfg) {
			emitLog({
				ts: new Date().toISOString(),
				stream: "stderr",
				line: "missing runnerConfig in request body — cannot run backup",
			});
			return 1;
		}
		const configContent = buildRcloneB2Config(cfg);
		const args = buildRcloneSyncArgs(cfg);
		return spawn(args, { configContent, onLog: emitLog });
	};
}

export const realRcloneSpawnForBackup: SpawnRcloneFn = async (args, opts) => {
	const dir = await mkdtemp(join(tmpdir(), "grota-rclone-backup-"));
	const configPath = join(dir, "rclone.conf");
	await writeFile(configPath, opts.configContent, { mode: 0o600 });
	try {
		const finalArgs = args.map((a) => (a === CONFIG_PLACEHOLDER ? configPath : a));
		const result = await spawnJob({
			command: "rclone",
			args: finalArgs,
			onLog: opts.onLog,
		});
		return result.exitCode;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};
