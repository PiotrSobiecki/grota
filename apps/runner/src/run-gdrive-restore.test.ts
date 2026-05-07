import type { GDriveRestoreRequest, LogLine } from "@repo/data-ops/migration";
import { describe, expect, it, vi } from "vitest";
import {
	buildRcloneGDriveConfig,
	buildRcloneGDriveRestoreArgs,
	createRunGDriveRestore,
} from "./run-gdrive-restore";
import type { SpawnRcloneFn } from "./run-backup";

const validRequest: GDriveRestoreRequest = {
	account: "user@example.com",
	runnerConfig: {
		b2KeyId: "K001abc",
		b2AppKey: "supersecret",
		bucketPrefix: "client-x",
		backupPath: "/srv/backup/gdrive",
	},
	gdrive: {
		clientId: "g-client-id",
		clientSecret: "g-client-secret",
		accessToken: "ya29.a0Af",
		refreshToken: "1//0g",
		expiry: "2026-05-07T12:00:00.000Z",
	},
};

describe("buildRcloneGDriveConfig", () => {
	it("emits [gdrive] block with token JSON containing all required fields", () => {
		const config = buildRcloneGDriveConfig(validRequest.gdrive);
		expect(config).toContain("[gdrive]");
		expect(config).toContain("type = drive");
		expect(config).toContain("client_id = g-client-id");
		expect(config).toContain("client_secret = g-client-secret");
		expect(config).toContain("token = ");
		const tokenLine = config.split("\n").find((l) => l.startsWith("token = "));
		const tokenJson = JSON.parse(tokenLine!.replace("token = ", ""));
		expect(tokenJson.access_token).toBe("ya29.a0Af");
		expect(tokenJson.refresh_token).toBe("1//0g");
		expect(tokenJson.expiry).toBe("2026-05-07T12:00:00.000Z");
	});

	it("includes team_drive when sharedDriveId provided", () => {
		const config = buildRcloneGDriveConfig({
			...validRequest.gdrive,
			sharedDriveId: "0ABC123",
		});
		expect(config).toContain("team_drive = 0ABC123");
	});

	it("omits team_drive when sharedDriveId absent", () => {
		const config = buildRcloneGDriveConfig(validRequest.gdrive);
		expect(config).not.toContain("team_drive =");
	});
});

describe("buildRcloneGDriveRestoreArgs", () => {
	it("syncs from local backupPath/account to gdrive:account/ with -v", () => {
		const args = buildRcloneGDriveRestoreArgs(validRequest);
		expect(args[0]).toBe("sync");
		expect(args).toContain("/srv/backup/gdrive/user@example.com");
		expect(args).toContain("gdrive:user@example.com");
		expect(args).toContain("--config");
		expect(args).toContain("-v");
	});

	it("uses targetFolder when provided instead of account-derived folder", () => {
		const args = buildRcloneGDriveRestoreArgs({
			...validRequest,
			gdrive: { ...validRequest.gdrive, targetFolder: "Restored/Jan-Kowalski" },
		});
		expect(args).toContain("gdrive:Restored/Jan-Kowalski");
	});
});

describe("createRunGDriveRestore", () => {
	it("calls spawn with config + args, returns its exit code", async () => {
		let captured: { args: string[]; configContent: string } | null = null;
		const spawn: SpawnRcloneFn = vi.fn(async (args, opts) => {
			captured = { args, configContent: opts.configContent };
			return 0;
		});
		const run = createRunGDriveRestore(spawn, async () => true);
		const logs: LogLine[] = [];
		const exit = await run("job-1", validRequest, (l) => logs.push(l));
		expect(exit).toBe(0);
		expect(captured).not.toBeNull();
		expect(captured!.args[0]).toBe("sync");
		expect(captured!.configContent).toContain("[gdrive]");
	});

	it("returns exit 2 with stderr when source path does not exist (no Migrate done yet)", async () => {
		const spawn: SpawnRcloneFn = vi.fn();
		const run = createRunGDriveRestore(spawn, async () => false);
		const logs: LogLine[] = [];
		const exit = await run("job-1", validRequest, (l) => logs.push(l));
		expect(exit).toBe(2);
		expect(spawn).not.toHaveBeenCalled();
		expect(logs[0]?.stream).toBe("stderr");
		expect(logs[0]?.line).toMatch(/source path .* does not exist|nie istnieje/i);
	});
});
