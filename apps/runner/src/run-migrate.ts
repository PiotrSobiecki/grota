import type { MigrateRequest, RunnerJobConfig } from "@repo/data-ops/migration";
import type { LogEmitter, RunMigrateFn } from "./app.js";
import { buildRcloneB2Config, type SpawnRcloneFn } from "./run-backup.js";

const CONFIG_PLACEHOLDER = "<tmp>";

export function buildRcloneMigrateArgs(cfg: RunnerJobConfig, dryRun: boolean): string[] {
	const args = [
		"sync",
		`b2:${cfg.bucketPrefix}`,
		cfg.backupPath,
		"--config",
		CONFIG_PLACEHOLDER,
		"-v",
	];
	if (cfg.bwlimit) args.push("--bwlimit", cfg.bwlimit);
	if (dryRun) args.push("--dry-run");
	return args;
}

export function createRunMigrate(spawn: SpawnRcloneFn): RunMigrateFn {
	return async (_jobId: string, req: MigrateRequest, emitLog: LogEmitter) => {
		const cfg = req.runnerConfig;
		if (!cfg) {
			emitLog({
				ts: new Date().toISOString(),
				stream: "stderr",
				line: "missing runnerConfig in request body — cannot run migrate",
			});
			return 1;
		}
		const configContent = buildRcloneB2Config(cfg);
		const args = buildRcloneMigrateArgs(cfg, req.dryRun);
		return spawn(args, { configContent, onLog: emitLog });
	};
}
