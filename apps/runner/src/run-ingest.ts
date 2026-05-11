import type { GDriveCredentials, IngestFolder, RunnerJobConfig } from "@repo/data-ops/migration";
import type { LogEmitter, RunIngestFn } from "./app.js";
import { type SpawnRcloneFn, buildRcloneB2Config } from "./run-backup.js";

export function buildRcloneIngestConfig(
	account: string,
	creds: GDriveCredentials,
	cfg: RunnerJobConfig,
): string {
	const remoteName = `gdrive_${sanitizeEmail(account)}`;
	const tokenPayload = {
		access_token: creds.accessToken,
		refresh_token: creds.refreshToken,
		expiry: creds.expiry,
		token_type: "Bearer",
	};
	const gdriveBlock = [
		`[${remoteName}]`,
		"type = drive",
		`client_id = ${creds.clientId}`,
		`client_secret = ${creds.clientSecret}`,
		`token = ${JSON.stringify(tokenPayload)}`,
		"",
	].join("\n");
	return `${buildRcloneB2Config(cfg)}\n${gdriveBlock}`;
}

const EXPORT_FORMATS = "docx,xlsx,pptx,pdf";
const CONFIG_PLACEHOLDER = "<tmp>";

export function sanitizeEmail(email: string): string {
	return email.replace(/[@.]/g, "_");
}

export function buildRcloneIngestArgs(
	folder: IngestFolder,
	account: string,
	cfg: RunnerJobConfig,
	timestamp: string,
): string[] {
	const sanitized = sanitizeEmail(account);
	const remote = `gdrive_${sanitized}:`;
	const sdName = folder.sharedDriveName ?? "";
	const driveRoot = folder.parentFolderId ?? folder.sharedDriveId ?? "root";
	if (folder.itemType === "file") {
		const targetDir = `${cfg.backupPath}/${sanitized}/${sdName}/_files/${folder.itemName}`;
		return [
			"copy",
			remote,
			targetDir,
			"--config",
			CONFIG_PLACEHOLDER,
			"--drive-root-folder-id",
			driveRoot,
			"--include",
			`/${folder.itemName}`,
			"--drive-export-formats",
			EXPORT_FORMATS,
			"-v",
		];
	}
	const versionDir = `${cfg.backupPath}/.versions/${sanitized}/${timestamp}`;
	const targetDir = `${cfg.backupPath}/${sanitized}/${sdName}/${folder.itemName}`;
	return [
		"sync",
		remote,
		targetDir,
		"--config",
		CONFIG_PLACEHOLDER,
		"--drive-root-folder-id",
		folder.itemId,
		"--backup-dir",
		versionDir,
		"--drive-export-formats",
		EXPORT_FORMATS,
		"-v",
	];
}

function nowStamp(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
		`-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
	);
}

export function createRunIngest(spawn: SpawnRcloneFn): RunIngestFn {
	return async (_jobId, req, emitLog: LogEmitter) => {
		const timestamp = nowStamp();
		const configContent = buildRcloneIngestConfig(req.account, req.gdrive, req.runnerConfig);
		let failed = 0;
		for (const folder of req.folders) {
			if (!folder.sharedDriveName) {
				emitLog({
					ts: new Date().toISOString(),
					stream: "stdout",
					line: `Skipping: ${folder.itemName} (not assigned to shared drive)`,
				});
				continue;
			}
			const args = buildRcloneIngestArgs(folder, req.account, req.runnerConfig, timestamp);
			const rc = await spawn(args, { configContent, onLog: emitLog });
			if (rc === 9) {
				emitLog({
					ts: new Date().toISOString(),
					stream: "stderr",
					line: `OAuth revoked for ${req.account} (folder: ${folder.itemName})`,
				});
				return 6;
			}
			if (rc !== 0) {
				failed++;
				emitLog({
					ts: new Date().toISOString(),
					stream: "stderr",
					line: `Failed: ${folder.itemName} (rclone exit ${rc})`,
				});
			}
		}
		return failed > 0 ? 7 : 0;
	};
}
