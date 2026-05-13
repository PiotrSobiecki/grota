import { access } from "node:fs/promises";
import type { GDriveRestoreRequest, ScheduledCycleRequest } from "@repo/data-ops/migration";
import type { LogEmitter } from "./app.js";
import { buildRcloneB2Config, buildRcloneSyncArgs, type SpawnRcloneFn } from "./run-backup.js";
import {
	buildRcloneGDriveConfig,
	buildRcloneGDriveRestoreArgs,
	type PathExistsFn,
} from "./run-gdrive-restore.js";
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

function sanitizeEmail(email: string): string {
	return email.replace(/[@.]/g, "_");
}

const defaultPathExists: PathExistsFn = async (p) => {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
};

export function createRunScheduledCycle(
	spawn: SpawnRcloneFn,
	pathExists: PathExistsFn = defaultPathExists,
): RunScheduledCycleFn {
	return async (_jobId, req, emitLog) => {
		const timestamp = nowStamp();

		for (const employee of req.employees) {
			if (!employee.gdrive) {
				const reason = employee.skipReason ?? "no_oauth";
				emitLog({
					ts: new Date().toISOString(),
					stream: "stdout",
					line: `skipped: ${employee.account} (${reason})`,
				});
				continue;
			}
			if (employee.folders.length === 0) {
				const reason = employee.skipReason ?? "no_folders";
				emitLog({
					ts: new Date().toISOString(),
					stream: "stdout",
					line: `skipped: ${employee.account} (${reason})`,
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
		const backupExit = await spawn(backupArgs, { configContent: backupConfig, onLog: emitLog });

		if (!req.gdriveRestore) return backupExit;

		let anySuccess = false;
		let anyFail = false;
		let lastFailExit = 0;
		for (const target of req.gdriveRestore.targets) {
			const sourcePath = `${req.runnerConfig.backupPath}/${sanitizeEmail(target.account)}`;
			if (!(await pathExists(sourcePath))) {
				emitLog({
					ts: new Date().toISOString(),
					stream: "stdout",
					line: `restore_skipped: ${target.account} (no_source)`,
				});
				continue;
			}
			emitLog({
				ts: new Date().toISOString(),
				stream: "stdout",
				line: `restore_started: ${target.account}`,
			});
			const restoreReq: GDriveRestoreRequest = {
				account: target.account,
				runnerConfig: req.runnerConfig,
				gdrive: { ...req.gdriveRestore.gdrive, targetFolder: target.targetFolder },
				...(target.includePaths ? { includePaths: target.includePaths } : {}),
			};
			const restoreArgs = buildRcloneGDriveRestoreArgs(restoreReq);
			const restoreConfig = buildRcloneGDriveConfig(restoreReq.gdrive);
			const exit = await spawn(restoreArgs, { configContent: restoreConfig, onLog: emitLog });
			if (exit === 0) {
				anySuccess = true;
				emitLog({
					ts: new Date().toISOString(),
					stream: "stdout",
					line: `restore_done: ${target.account}`,
				});
			} else {
				anyFail = true;
				lastFailExit = exit;
				emitLog({
					ts: new Date().toISOString(),
					stream: "stderr",
					line: `restore_failed: ${target.account} (exit ${exit})`,
				});
			}
		}
		if (anyFail && anySuccess) return 7;
		if (anyFail) return lastFailExit;
		return backupExit;
	};
}
