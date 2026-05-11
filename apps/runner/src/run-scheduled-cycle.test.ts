import type {
	GDriveCredentials,
	IngestFolder,
	LogLine,
	RunnerJobConfig,
	ScheduledCycleEmployee,
} from "@repo/data-ops/migration";
import { describe, expect, it, vi } from "vitest";
import type { SpawnRcloneFn } from "./run-backup";
import { createRunScheduledCycle } from "./run-scheduled-cycle";

const runnerConfig: RunnerJobConfig = {
	b2KeyId: "K001abc",
	b2AppKey: "secret",
	bucketPrefix: "client-x",
	backupPath: "/srv/backup",
};

const gdrive: GDriveCredentials = {
	clientId: "client-id",
	clientSecret: "client-secret",
	accessToken: "access",
	refreshToken: "refresh",
	expiry: "2026-12-31T23:59:59.000Z",
};

const folder: IngestFolder = {
	itemId: "fid-1",
	itemName: "Folder 1",
	itemType: "folder",
	parentFolderId: null,
	sharedDriveName: "Shared Drive A",
	sharedDriveId: "sd-1",
	mimeType: null,
};

function eligibleEmployee(email: string): ScheduledCycleEmployee {
	return { account: email, gdrive, folders: [folder] };
}

describe("runScheduledCycle", () => {
	it("spawns one rclone per eligible employee then one backup spawn, returns 0", async () => {
		const spawn: SpawnRcloneFn = vi.fn(async () => 0);
		const run = createRunScheduledCycle(spawn);
		const emit: (line: LogLine) => void = vi.fn();

		const exitCode = await run(
			"job-1",
			{
				runnerConfig,
				employees: [
					eligibleEmployee("a@example.com"),
					eligibleEmployee("b@example.com"),
					eligibleEmployee("c@example.com"),
				],
			},
			emit,
		);

		expect(exitCode).toBe(0);
		// 3 ingest spawns (one per employee) + 1 backup spawn = 4 total
		expect(spawn).toHaveBeenCalledTimes(4);
		const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
		// Last spawn must be the backup sync (rclone sync <backupPath> b2:<bucketPrefix>)
		const lastArgs = calls[calls.length - 1]?.[0] as string[];
		expect(lastArgs[0]).toBe("sync");
		expect(lastArgs).toContain("/srv/backup");
	});

	it("skips employee with null gdrive, emits SSE 'skipped' log, still runs backup, returns 0", async () => {
		const spawn: SpawnRcloneFn = vi.fn(async () => 0);
		const run = createRunScheduledCycle(spawn);
		const logs: LogLine[] = [];
		const emit = (line: LogLine) => logs.push(line);

		const ungated: ScheduledCycleEmployee = {
			account: "ungated@example.com",
			gdrive: null,
			folders: [],
		};

		const exitCode = await run(
			"job-2",
			{
				runnerConfig,
				employees: [eligibleEmployee("a@example.com"), ungated, eligibleEmployee("c@example.com")],
			},
			emit,
		);

		expect(exitCode).toBe(0);
		// 2 ingest spawns (eligible only) + 1 backup = 3 total
		expect(spawn).toHaveBeenCalledTimes(3);
		const skippedLog = logs.find((l) => l.line.includes("ungated@example.com"));
		expect(skippedLog?.line).toContain("skipped");
		expect(skippedLog?.line).toContain("no_oauth");
	});
});
