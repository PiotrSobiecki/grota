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

const GOOGLE_MIME_TO_EXT: Record<string, string> = {
	"application/vnd.google-apps.document": ".docx",
	"application/vnd.google-apps.spreadsheet": ".xlsx",
	"application/vnd.google-apps.presentation": ".pptx",
	"application/vnd.google-apps.drawing": ".pdf",
	"application/vnd.google-apps.form": ".pdf",
};

function exportExtFor(mimeType: string | null): string {
	if (!mimeType) return "";
	return GOOGLE_MIME_TO_EXT[mimeType] ?? "";
}

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
	// Source dla rclone:
	// - parentFolderId set       → folder ID (My Drive lub global folder ID)
	// - parentFolderId null + sharedDriveId → plik "Shared with me" (admin
	//                              workspace go udostepnil pracownikowi),
	//                              uzywamy --drive-shared-with-me
	// - oba null                 → My Drive root pracownika
	// sharedDriveId w folder_selections to TAG/destination (gdzie pliki maja
	// byc archiwizowane), nie source context.
	const sourceFlags: string[] =
		folder.parentFolderId !== null
			? ["--drive-root-folder-id", folder.parentFolderId]
			: folder.sharedDriveId !== null
				? ["--drive-shared-with-me"]
				: ["--drive-root-folder-id", "root"];
	if (folder.itemType === "file") {
		const targetDir = `${cfg.backupPath}/${sanitized}/${sdName}/_files/${folder.itemName}`;
		const ext = exportExtFor(folder.mimeType);
		return [
			"copy",
			remote,
			targetDir,
			"--config",
			CONFIG_PLACEHOLDER,
			...sourceFlags,
			"--include",
			`/${folder.itemName}${ext}`,
			"--drive-export-formats",
			EXPORT_FORMATS,
			"-vv",
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
		"-vv",
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
