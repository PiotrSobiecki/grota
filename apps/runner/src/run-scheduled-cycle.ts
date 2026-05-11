import type { ScheduledCycleRequest } from "@repo/data-ops/migration";
import type { LogEmitter } from "./app.js";
import { buildRcloneB2Config, buildRcloneSyncArgs, type SpawnRcloneFn } from "./run-backup.js";
import { buildRcloneIngestArgs, buildRcloneIngestConfig } from "./run-ingest.js";

export type RunScheduledCycleFn = (
	jobId: string,
	req: ScheduledCycleRequest,
	emitLog: LogEmitter,
) => Promise<number>;

function nowStamp(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
		`-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
	);
}

export function createRunScheduledCycle(spawn: SpawnRcloneFn): RunScheduledCycleFn {
	return async (_jobId, req, emitLog) => {
		const timestamp = nowStamp();

		for (const employee of req.employees) {
			if (!employee.gdrive) {
				emitLog({
					ts: new Date().toISOString(),
					stream: "stdout",
					line: `skipped: ${employee.account} (no_oauth)`,
				});
				continue;
			}
			if (employee.folders.length === 0) {
				emitLog({
					ts: new Date().toISOString(),
					stream: "stdout",
					line: `skipped: ${employee.account} (no_folders)`,
				});
				continue;
			}

			const configContent = buildRcloneIngestConfig(
				employee.account,
				employee.gdrive,
				req.runnerConfig,
			);
			for (const folder of employee.folders) {
				const args = buildRcloneIngestArgs(folder, employee.account, req.runnerConfig, timestamp);
				await spawn(args, { configContent, onLog: emitLog });
			}
		}

		const backupConfig = buildRcloneB2Config(req.runnerConfig);
		const backupArgs = buildRcloneSyncArgs(req.runnerConfig);
		return spawn(backupArgs, { configContent: backupConfig, onLog: emitLog });
	};
}
