import type { IngestRequest, IngestFolder, LogLine, RunnerJobConfig } from "@repo/data-ops/migration";
import { describe, expect, it, vi } from "vitest";
import type { SpawnRcloneFn } from "./run-backup";
import {
	buildRcloneIngestArgs,
	buildRcloneIngestConfig,
	createRunIngest,
	sanitizeEmail,
} from "./run-ingest";

const GDRIVE_CREDS = {
	clientId: "g-client-id",
	clientSecret: "g-client-secret",
	accessToken: "ya29.x",
	refreshToken: "1//y",
	expiry: "2026-05-11T12:00:00.000Z",
};

function buildRequest(folders: IngestFolder[]): IngestRequest {
	return {
		account: ACCOUNT,
		runnerConfig: RUNNER_CONFIG,
		gdrive: GDRIVE_CREDS,
		folders,
	};
}

const RUNNER_CONFIG: RunnerJobConfig = {
	b2KeyId: "K001abc",
	b2AppKey: "supersecret",
	bucketPrefix: "client-x",
	backupPath: "/srv/backup/gdrive",
};
const ACCOUNT = "piotr.sobiecki@gmail.com";
const TIMESTAMP = "20260511-093000";
const REMOTE = `gdrive_${sanitizeEmail(ACCOUNT)}`;

describe("sanitizeEmail", () => {
	it("replaces '@' and '.' with '_' to match CLI backup.sh convention", () => {
		expect(sanitizeEmail("piotr.sobiecki@gmail.com")).toBe("piotr_sobiecki_gmail_com");
	});
});

describe("buildRcloneIngestArgs", () => {
	it("returns `rclone sync` args for itemType=folder with backup-dir and export-formats", () => {
		const folder: IngestFolder = {
			itemId: "1AbCfolderId",
			itemName: "Projekty",
			itemType: "folder",
			parentFolderId: null,
			sharedDriveName: "Klient-X",
			sharedDriveId: "0KX",
			mimeType: "application/vnd.google-apps.folder",
		};
		const args = buildRcloneIngestArgs(folder, ACCOUNT, RUNNER_CONFIG, TIMESTAMP);
		expect(args[0]).toBe("sync");
		expect(args[1]).toBe(`${REMOTE}:`);
		expect(args[2]).toBe("/srv/backup/gdrive/piotr_sobiecki_gmail_com/Klient-X/Projekty");
		expect(args).toContain("--drive-root-folder-id");
		const rootIdx = args.indexOf("--drive-root-folder-id");
		expect(args[rootIdx + 1]).toBe("1AbCfolderId");
		expect(args).toContain("--backup-dir");
		const backupIdx = args.indexOf("--backup-dir");
		expect(args[backupIdx + 1]).toBe(
			"/srv/backup/gdrive/.versions/piotr_sobiecki_gmail_com/20260511-093000",
		);
		expect(args).toContain("--drive-export-formats");
		const fmtIdx = args.indexOf("--drive-export-formats");
		expect(args[fmtIdx + 1]).toBe("docx,xlsx,pptx,pdf");
	});

	it("returns `rclone copy` args for itemType=file with --include /<name> and _files/ path", () => {
		const file: IngestFolder = {
			itemId: "1FileId",
			itemName: "raport.docx",
			itemType: "file",
			parentFolderId: "1ParentFolderId",
			sharedDriveName: "Klient-X",
			sharedDriveId: "0KX",
			mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		};
		const args = buildRcloneIngestArgs(file, ACCOUNT, RUNNER_CONFIG, TIMESTAMP);
		expect(args[0]).toBe("copy");
		expect(args[1]).toBe(`${REMOTE}:`);
		expect(args[2]).toBe(
			"/srv/backup/gdrive/piotr_sobiecki_gmail_com/Klient-X/_files/raport.docx",
		);
		const rootIdx = args.indexOf("--drive-root-folder-id");
		expect(args[rootIdx + 1]).toBe("1ParentFolderId");
		const incIdx = args.indexOf("--include");
		expect(args[incIdx + 1]).toBe("/raport.docx");
		expect(args).not.toContain("--backup-dir");
		expect(args).toContain("--drive-export-formats");
	});

	it("uses --drive-shared-with-me when file has parentFolderId=null + sharedDriveId (Shared with me, owned by admin)", () => {
		const file: IngestFolder = {
			itemId: "1FileId",
			itemName: "x.pdf",
			itemType: "file",
			parentFolderId: null,
			sharedDriveName: "Klient-X",
			sharedDriveId: "0ABC123",
			mimeType: null,
		};
		const args = buildRcloneIngestArgs(file, ACCOUNT, RUNNER_CONFIG, TIMESTAMP);
		expect(args).toContain("--drive-shared-with-me");
		expect(args).not.toContain("--drive-root-folder-id");
		expect(args).not.toContain("--drive-team-drive");
	});

	it("adds export extension to --include for Google Sheet (mimeType=spreadsheet)", () => {
		const file: IngestFolder = {
			itemId: "fId",
			itemName: "koszty czerwiec GS",
			itemType: "file",
			parentFolderId: null,
			sharedDriveName: "SD",
			sharedDriveId: "0SD",
			mimeType: "application/vnd.google-apps.spreadsheet",
		};
		const args = buildRcloneIngestArgs(file, ACCOUNT, RUNNER_CONFIG, TIMESTAMP);
		const incIdx = args.indexOf("--include");
		expect(args[incIdx + 1]).toBe("/koszty czerwiec GS.xlsx");
	});

	it("adds .docx for Google Doc and .pptx for Google Slides", () => {
		const base = {
			itemId: "x",
			itemType: "file" as const,
			parentFolderId: null,
			sharedDriveName: "SD",
			sharedDriveId: "0SD",
		};
		const doc = buildRcloneIngestArgs(
			{ ...base, itemName: "Notatki", mimeType: "application/vnd.google-apps.document" },
			ACCOUNT,
			RUNNER_CONFIG,
			TIMESTAMP,
		);
		expect(doc[doc.indexOf("--include") + 1]).toBe("/Notatki.docx");
		const slides = buildRcloneIngestArgs(
			{ ...base, itemName: "Pitch", mimeType: "application/vnd.google-apps.presentation" },
			ACCOUNT,
			RUNNER_CONFIG,
			TIMESTAMP,
		);
		expect(slides[slides.indexOf("--include") + 1]).toBe("/Pitch.pptx");
	});

	it("keeps --include without extension for native files (mimeType not google-apps)", () => {
		const native: IngestFolder = {
			itemId: "fId",
			itemName: "report.pdf",
			itemType: "file",
			parentFolderId: "p",
			sharedDriveName: "SD",
			sharedDriveId: "0SD",
			mimeType: "application/pdf",
		};
		const args = buildRcloneIngestArgs(native, ACCOUNT, RUNNER_CONFIG, TIMESTAMP);
		const incIdx = args.indexOf("--include");
		expect(args[incIdx + 1]).toBe("/report.pdf");
	});

	it("NEVER adds --drive-team-drive (ingest source = My Drive pracownika, NIE shared drive firmy)", () => {
		const folder: IngestFolder = {
			itemId: "f1",
			itemName: "X.pdf",
			itemType: "file",
			parentFolderId: null,
			sharedDriveName: "SD",
			sharedDriveId: "0SDxyz",
			mimeType: "application/pdf",
		};
		const args = buildRcloneIngestArgs(folder, ACCOUNT, RUNNER_CONFIG, TIMESTAMP);
		expect(args).not.toContain("--drive-team-drive");
	});

	it("falls back parentFolderId='root' when both parentFolderId and sharedDriveId are null", () => {
		const file: IngestFolder = {
			itemId: "1FileId",
			itemName: "x.pdf",
			itemType: "file",
			parentFolderId: null,
			sharedDriveName: null,
			sharedDriveId: null,
			mimeType: null,
		};
		const args = buildRcloneIngestArgs(file, ACCOUNT, RUNNER_CONFIG, TIMESTAMP);
		const rootIdx = args.indexOf("--drive-root-folder-id");
		expect(args[rootIdx + 1]).toBe("root");
	});

	it("includes --config <tmp-placeholder> so rclone reads our config (not default path)", () => {
		const folder: IngestFolder = {
			itemId: "f1",
			itemName: "X",
			itemType: "folder",
			parentFolderId: null,
			sharedDriveName: "SD",
			sharedDriveId: "0SD",
			mimeType: null,
		};
		const argsFolder = buildRcloneIngestArgs(folder, ACCOUNT, RUNNER_CONFIG, TIMESTAMP);
		expect(argsFolder).toContain("--config");
		const argsFile = buildRcloneIngestArgs(
			{ ...folder, itemType: "file", parentFolderId: "p1", itemName: "f.pdf" },
			ACCOUNT,
			RUNNER_CONFIG,
			TIMESTAMP,
		);
		expect(argsFile).toContain("--config");
	});
});

describe("createRunIngest", () => {
	it("skips folder with sharedDriveName=null, logs reason, does not call spawn", async () => {
		const spawn: SpawnRcloneFn = vi.fn();
		const run = createRunIngest(spawn);
		const req = buildRequest([
			{
				itemId: "x",
				itemName: "Prywatne",
				itemType: "folder",
				parentFolderId: null,
				sharedDriveName: null,
				sharedDriveId: null,
				mimeType: null,
			},
		]);
		const logs: LogLine[] = [];
		const exit = await run("job-1", req, (l) => logs.push(l));
		expect(exit).toBe(0);
		expect(spawn).not.toHaveBeenCalled();
		expect(logs.some((l) => /skip|not assigned|pomi/i.test(l.line))).toBe(true);
	});

	it("spawns rclone once per assigned folder, returns 0 when all succeed", async () => {
		const callArgs: string[][] = [];
		const spawn: SpawnRcloneFn = vi.fn(async (args) => {
			callArgs.push(args);
			return 0;
		});
		const run = createRunIngest(spawn);
		const req = buildRequest([
			{
				itemId: "f1",
				itemName: "FolderA",
				itemType: "folder",
				parentFolderId: null,
				sharedDriveName: "Klient-X",
				sharedDriveId: "0KX",
				mimeType: null,
			},
			{
				itemId: "f2",
				itemName: "x.pdf",
				itemType: "file",
				parentFolderId: "p2",
				sharedDriveName: "Klient-X",
				sharedDriveId: "0KX",
				mimeType: null,
			},
		]);
		const exit = await run("job-1", req, () => {});
		expect(exit).toBe(0);
		expect(spawn).toHaveBeenCalledTimes(2);
		expect(callArgs[0]?.[0]).toBe("sync");
		expect(callArgs[1]?.[0]).toBe("copy");
	});

	it("returns exit 6 (OAuth revoked) when rclone exits 9, does not process later folders", async () => {
		let calls = 0;
		const spawn: SpawnRcloneFn = vi.fn(async () => {
			calls++;
			return 9;
		});
		const run = createRunIngest(spawn);
		const req = buildRequest([
			{
				itemId: "f1",
				itemName: "A",
				itemType: "folder",
				parentFolderId: null,
				sharedDriveName: "Klient-X",
				sharedDriveId: "0KX",
				mimeType: null,
			},
			{
				itemId: "f2",
				itemName: "B",
				itemType: "folder",
				parentFolderId: null,
				sharedDriveName: "Klient-X",
				sharedDriveId: "0KX",
				mimeType: null,
			},
		]);
		const exit = await run("job-1", req, () => {});
		expect(exit).toBe(6);
		expect(calls).toBe(1);
	});

	it("returns exit 7 (partial failure) when some folders fail with non-OAuth exit", async () => {
		const exits = [0, 1, 0];
		const spawn: SpawnRcloneFn = vi.fn(async () => exits.shift() ?? 0);
		const run = createRunIngest(spawn);
		const req = buildRequest([
			{
				itemId: "f1",
				itemName: "A",
				itemType: "folder",
				parentFolderId: null,
				sharedDriveName: "Klient-X",
				sharedDriveId: "0KX",
				mimeType: null,
			},
			{
				itemId: "f2",
				itemName: "B",
				itemType: "folder",
				parentFolderId: null,
				sharedDriveName: "Klient-X",
				sharedDriveId: "0KX",
				mimeType: null,
			},
			{
				itemId: "f3",
				itemName: "C",
				itemType: "folder",
				parentFolderId: null,
				sharedDriveName: "Klient-X",
				sharedDriveId: "0KX",
				mimeType: null,
			},
		]);
		const exit = await run("job-1", req, () => {});
		expect(exit).toBe(7);
		expect(spawn).toHaveBeenCalledTimes(3);
	});
});

describe("buildRcloneIngestConfig", () => {
	it("emits [b2] block and per-employee [gdrive_<sanitized>] block", () => {
		const config = buildRcloneIngestConfig(ACCOUNT, GDRIVE_CREDS, RUNNER_CONFIG);
		expect(config).toContain("[b2]");
		expect(config).toContain(`[gdrive_${sanitizeEmail(ACCOUNT)}]`);
		expect(config).toContain("type = drive");
		expect(config).toContain("client_id = g-client-id");
	});
});
