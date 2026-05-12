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

	it("when gdriveRestore present, after backup spawns 1 rclone sync to gdrive: per target and emits SSE", async () => {
		const spawn: SpawnRcloneFn = vi.fn(async () => 0);
		const run = createRunScheduledCycle(spawn, async () => true);
		const logs: LogLine[] = [];
		const emit = (line: LogLine) => logs.push(line);

		const exitCode = await run(
			"job-3",
			{
				runnerConfig,
				employees: [eligibleEmployee("a@example.com")],
				gdriveRestore: {
					gdrive: { ...gdrive, sharedDriveId: "company-sd" },
					targets: [{ account: "a@example.com", targetFolder: "a@example.com" }],
				},
			},
			emit,
		);

		expect(exitCode).toBe(0);
		// 1 ingest + 1 backup + 1 restore = 3 spawns
		expect(spawn).toHaveBeenCalledTimes(3);

		const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
		const restoreArgs = calls[2]?.[0] as string[];
		expect(restoreArgs[0]).toBe("sync");
		expect(restoreArgs).toContain("/srv/backup/a_example_com");
		expect(restoreArgs.some((a) => a.startsWith("gdrive:"))).toBe(true);

		const started = logs.find(
			(l) => l.line.includes("restore_started") && l.line.includes("a@example.com"),
		);
		const done = logs.find(
			(l) => l.line.includes("restore_done") && l.line.includes("a@example.com"),
		);
		expect(started).toBeDefined();
		expect(done).toBeDefined();
	});

	it("when gdriveRestore has N targets, runs N rclone syncs in order with paired SSE events per account", async () => {
		const spawn: SpawnRcloneFn = vi.fn(async () => 0);
		const run = createRunScheduledCycle(spawn, async () => true);
		const logs: LogLine[] = [];
		const emit = (line: LogLine) => logs.push(line);

		const exitCode = await run(
			"job-4",
			{
				runnerConfig,
				employees: [
					eligibleEmployee("a@example.com"),
					eligibleEmployee("b@example.com"),
					eligibleEmployee("c@example.com"),
				],
				gdriveRestore: {
					gdrive: { ...gdrive, sharedDriveId: "company-sd" },
					targets: [
						{ account: "a@example.com", targetFolder: "a@example.com" },
						{ account: "b@example.com", targetFolder: "b@example.com" },
						{ account: "c@example.com", targetFolder: "c@example.com" },
					],
				},
			},
			emit,
		);

		expect(exitCode).toBe(0);
		// 3 ingest + 1 backup + 3 restore = 7 spawns
		expect(spawn).toHaveBeenCalledTimes(7);

		const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
		// restore spawns are at indices 4, 5, 6 — order must match targets
		const restoreArgsA = calls[4]?.[0] as string[];
		const restoreArgsB = calls[5]?.[0] as string[];
		const restoreArgsC = calls[6]?.[0] as string[];
		expect(restoreArgsA).toContain("/srv/backup/a_example_com");
		expect(restoreArgsB).toContain("/srv/backup/b_example_com");
		expect(restoreArgsC).toContain("/srv/backup/c_example_com");

		// 3 started + 3 done events, paired per account
		for (const acc of ["a@example.com", "b@example.com", "c@example.com"]) {
			expect(logs.some((l) => l.line === `restore_started: ${acc}`)).toBe(true);
			expect(logs.some((l) => l.line === `restore_done: ${acc}`)).toBe(true);
		}
	});

	it("restore phase: skips target without source path with 'restore_skipped: X (no_source)' log, no spawn for that account", async () => {
		const spawn: SpawnRcloneFn = vi.fn(async () => 0);
		const pathExists = vi.fn(async (p: string) => !p.endsWith("/missing_example_com"));
		const run = createRunScheduledCycle(spawn, pathExists);
		const logs: LogLine[] = [];
		const emit = (line: LogLine) => logs.push(line);

		const exitCode = await run(
			"job-5",
			{
				runnerConfig,
			employees: [eligibleEmployee("a@example.com"), eligibleEmployee("missing@example.com")],
				gdriveRestore: {
					gdrive: { ...gdrive, sharedDriveId: "company-sd" },
					targets: [
						{ account: "a@example.com", targetFolder: "a@example.com" },
						{ account: "missing@example.com", targetFolder: "missing@example.com" },
					],
				},
			},
			emit,
		);

		expect(exitCode).toBe(0);
		// 2 ingest + 1 backup + 1 restore (only for 'a') = 4 spawns
		expect(spawn).toHaveBeenCalledTimes(4);

		expect(logs.some((l) => l.line === "restore_skipped: missing@example.com (no_source)")).toBe(
			true,
		);
		expect(logs.some((l) => l.line === "restore_done: a@example.com")).toBe(true);
		// no restore_done emitted for the skipped account
		expect(logs.some((l) => l.line === "restore_done: missing@example.com")).toBe(false);
	});

	it("restore phase: when one target fails rclone (exit 5) and another succeeds, returns 7 and logs 'restore_failed' for the failing account", async () => {
		// First 2 calls = ingest (succeed), 3rd = backup (succeed), 4th = restore a (succeed), 5th = restore b (fail)
		const exits = [0, 0, 0, 0, 5];
		let callIndex = 0;
		const spawn: SpawnRcloneFn = vi.fn(async () => exits[callIndex++] ?? 0);
		const run = createRunScheduledCycle(spawn, async () => true);
		const logs: LogLine[] = [];
		const emit = (line: LogLine) => logs.push(line);

		const exitCode = await run(
			"job-6",
			{
				runnerConfig,
				employees: [eligibleEmployee("a@example.com"), eligibleEmployee("b@example.com")],
				gdriveRestore: {
					gdrive: { ...gdrive, sharedDriveId: "company-sd" },
					targets: [
						{ account: "a@example.com", targetFolder: "a@example.com" },
						{ account: "b@example.com", targetFolder: "b@example.com" },
					],
				},
			},
			emit,
		);

		expect(exitCode).toBe(7);
		expect(logs.some((l) => l.line === "restore_done: a@example.com")).toBe(true);
		expect(logs.some((l) => l.line === "restore_failed: b@example.com (exit 5)")).toBe(true);
		// no restore_done for the failing account
		expect(logs.some((l) => l.line === "restore_done: b@example.com")).toBe(false);
	});

	it("restore phase: when all targets are skipped (no source paths), returns 0 with skip logs only", async () => {
		const spawn: SpawnRcloneFn = vi.fn(async () => 0);
		const run = createRunScheduledCycle(spawn, async () => false);
		const logs: LogLine[] = [];
		const emit = (line: LogLine) => logs.push(line);

		const exitCode = await run(
			"job-7",
			{
				runnerConfig,
				employees: [eligibleEmployee("a@example.com"), eligibleEmployee("b@example.com")],
				gdriveRestore: {
					gdrive: { ...gdrive, sharedDriveId: "company-sd" },
					targets: [
						{ account: "a@example.com", targetFolder: "a@example.com" },
						{ account: "b@example.com", targetFolder: "b@example.com" },
					],
				},
			},
			emit,
		);

		expect(exitCode).toBe(0);
		// 2 ingest + 1 backup + 0 restore = 3 spawns total
		expect(spawn).toHaveBeenCalledTimes(3);
		expect(logs.filter((l) => l.line.startsWith("restore_skipped:"))).toHaveLength(2);
		expect(logs.some((l) => l.line.startsWith("restore_done:"))).toBe(false);
		expect(logs.some((l) => l.line.startsWith("restore_failed:"))).toBe(false);
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
