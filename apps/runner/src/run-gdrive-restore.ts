import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GDriveCredentials, GDriveRestoreRequest } from "@repo/data-ops/migration";
import type { LogEmitter, RunGDriveRestoreFn } from "./app.js";
import { type SpawnRcloneFn, buildRcloneB2Config } from "./run-backup.js";
import { spawnJob } from "./spawn-job.js";

export type PathExistsFn = (path: string) => Promise<boolean>;

const CONFIG_PLACEHOLDER = "<tmp>";

export function buildRcloneGDriveConfig(creds: GDriveCredentials): string {
	const tokenPayload = {
		access_token: creds.accessToken,
		refresh_token: creds.refreshToken,
		expiry: creds.expiry,
		token_type: "Bearer",
	};
	const lines = [
		"[gdrive]",
		"type = drive",
		`client_id = ${creds.clientId}`,
		`client_secret = ${creds.clientSecret}`,
		`token = ${JSON.stringify(tokenPayload)}`,
	];
	if (creds.sharedDriveId) {
		lines.push(`team_drive = ${creds.sharedDriveId}`);
	}
	lines.push("");
	return lines.join("\n");
}

export function buildRcloneGDriveRestoreArgs(req: GDriveRestoreRequest): string[] {
	const targetFolder = req.gdrive.targetFolder ?? req.account;
	const sourcePath = `${req.runnerConfig.backupPath}/${req.account}`;
	return [
		"sync",
		sourcePath,
		`gdrive:${targetFolder}`,
		"--config",
		CONFIG_PLACEHOLDER,
		"-v",
	];
}

export function createRunGDriveRestore(
	spawn: SpawnRcloneFn,
	pathExists: PathExistsFn = realPathExists,
): RunGDriveRestoreFn {
	return async (_jobId: string, req: GDriveRestoreRequest, emitLog: LogEmitter) => {
		const sourcePath = `${req.runnerConfig.backupPath}/${req.account}`;
		const exists = await pathExists(sourcePath);
		if (!exists) {
			emitLog({
				ts: new Date().toISOString(),
				stream: "stderr",
				line: `source path ${sourcePath} does not exist — uruchom najpierw Migrate (B2 -> lokalny)`,
			});
			return 2;
		}
		const configContent = [
			buildRcloneB2Config(req.runnerConfig),
			buildRcloneGDriveConfig(req.gdrive),
		].join("\n");
		const args = buildRcloneGDriveRestoreArgs(req);
		return spawn(args, { configContent, onLog: emitLog });
	};
}

const realPathExists: PathExistsFn = async (p) => {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
};

export const realRcloneSpawnForGDriveRestore: SpawnRcloneFn = async (args, opts) => {
	const dir = await mkdtemp(join(tmpdir(), "grota-rclone-gdrive-"));
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
