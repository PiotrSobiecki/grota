import {
	getDeployment,
	setDeploymentServerConfig,
	setWorkspaceOAuthToken,
	updateDeployment,
} from "@repo/data-ops/deployment";
import {
	createEmployee,
	setDriveOAuthToken,
	updateEmployeeSelectionStatus,
} from "@repo/data-ops/employee";
import { encrypt, encryptServerConfig } from "@repo/data-ops/encryption";
import { createFolderSelections } from "@repo/data-ops/folder-selection";
import { createMigrationJob, listMigrationJobs } from "@repo/data-ops/migration";
import { getSchedule, setSchedule, updateScheduleAfterRun } from "@repo/data-ops/schedule";
import { upsertSharedDrives } from "@repo/data-ops/shared-drive";
import { createTestDeployment } from "@repo/data-ops/test-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDueSchedules } from "./run-due-schedules";

function encryptionKey(): string {
	const key = process.env.ENCRYPTION_KEY;
	if (!key) throw new Error("ENCRYPTION_KEY not set");
	return key;
}

function envForTest(): Env {
	return {
		ENCRYPTION_KEY: encryptionKey(),
		TELEGRAM_BOT_TOKEN: "test-bot-token",
		TELEGRAM_CHAT_ID: "-100test",
		RESEND_API_KEY: "re_test",
		OPERATOR_ALERT_EMAIL: "ops@example.com",
		PUBLIC_APP_URL: "https://app.example.com",
		GOOGLE_CLIENT_ID: "test-google-client-id",
		GOOGLE_CLIENT_SECRET: "test-google-client-secret",
	} as unknown as Env;
}

async function setupEligibleDeployment(): Promise<string> {
	const deploymentId = await setupReadyDeployment();
	const sds = await upsertSharedDrives(deploymentId, [
		{ name: "Test SD", googleDriveId: "0ABC-sd" },
	]);
	const sharedDriveId = sds[0]?.id;
	if (!sharedDriveId) throw new Error("Shared drive insert failed");
	const employee = await createEmployee(deploymentId, {
		email: "alice@example.com",
		name: "Alice",
	});
	const tokenPayload = {
		access_token: "employee-access-token",
		refresh_token: "employee-refresh-token",
		expiry_date: Date.now() + 60 * 60 * 1000,
	};
	await setDriveOAuthToken(
		employee.id,
		await encrypt(JSON.stringify(tokenPayload), encryptionKey()),
	);
	await updateEmployeeSelectionStatus(employee.id, "completed");
	await createFolderSelections(employee.id, [
		{
			itemId: "folder-1",
			itemName: "Reports",
			itemType: "folder",
			parentFolderId: "0ROOT",
			mimeType: "application/vnd.google-apps.folder",
			sharedDriveId,
		},
	]);
	return deploymentId;
}

async function setupReadyDeployment(): Promise<string> {
	const deployment = await createTestDeployment();
	await updateDeployment(deployment.id, {
		b2Config: { key_id: "K001abcd", app_key: "K001secret", bucket_prefix: "test" },
	});
	await setDeploymentServerConfig(
		deployment.id,
		await encryptServerConfig(
			{
				backup_path: "client",
				bwlimit: "08:00,5M",
				runner_url: "https://runner.example.com",
				runner_token: "secret-token",
			},
			encryptionKey(),
		),
	);
	return deployment.id;
}

describe("runDueSchedules (integration)", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});
	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it("fails with NO_EMPLOYEES when deployment has runner config but no employees, leaves next_run_at untouched", async () => {
		const deploymentId = await setupReadyDeployment();
		await setSchedule(deploymentId, { enabled: true, intervalHours: 24, anchorTime: "02:00" });
		const before = await getSchedule(deploymentId);

		const result = await runDueSchedules(envForTest(), new Date());

		expect(result.attempted).toBe(1);
		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(1);

		const jobs = await listMigrationJobs({ deploymentId, limit: 10, offset: 0 });
		expect(jobs.length).toBe(0);

		const after = await getSchedule(deploymentId);
		expect(after?.nextRunAt?.getTime()).toBe(before?.nextRunAt?.getTime());
	});

	it("skips disabled schedules", async () => {
		const deploymentId = await setupReadyDeployment();
		await setSchedule(deploymentId, { enabled: true, intervalHours: 24, anchorTime: "02:00" });
		await setSchedule(deploymentId, { enabled: false, intervalHours: 24, anchorTime: "02:00" });

		const result = await runDueSchedules(envForTest(), new Date());

		expect(result.attempted).toBe(0);
		const jobs = await listMigrationJobs({ deploymentId, limit: 10, offset: 0 });
		expect(jobs.length).toBe(0);
	});

	it("skip-and-push when an active job locks the deployment", async () => {
		const deploymentId = await setupReadyDeployment();
		const deployment = await getDeployment(deploymentId);
		if (!deployment) throw new Error("deployment vanished");

		await createMigrationJob({
			deploymentId,
			type: "backup",
			account: null,
			dryRun: false,
			runnerJobId: "00000000-0000-0000-0000-000000000001",
			triggeredByUserId: deployment.createdBy,
		});

		await setSchedule(deploymentId, { enabled: true, intervalHours: 6, anchorTime: "02:00" });
		const before = await getSchedule(deploymentId);
		const tickAt = new Date();

		const result = await runDueSchedules(envForTest(), tickAt);

		const runnerCalls = fetchSpy.mock.calls.filter((c: Parameters<typeof fetch>) =>
			String(c[0]).startsWith("https://runner.example.com"),
		);
		expect(runnerCalls.length).toBe(0);
		expect(result.attempted).toBe(1);
		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(0);

		const jobs = await listMigrationJobs({ deploymentId, limit: 10, offset: 0 });
		expect(jobs.length).toBe(1); // only the pre-seeded one

		const after = await getSchedule(deploymentId);
		expect(after?.lastStatus).toBe("skipped:locked");
		expect(after?.retryAttemptsRemaining).toBe(0);
		const expectedNext = tickAt.getTime() + 6 * 60 * 60 * 1000;
		const actualNext = after?.nextRunAt?.getTime() ?? 0;
		expect(Math.abs(actualNext - expectedNext)).toBeLessThan(2000);
		// next_run_at moved forward from previous value
		expect(actualNext).toBeGreaterThan(before?.nextRunAt?.getTime() ?? 0);
	});

	it("marks schedule retry_pending and pushes next_run_at by 5min on first runner POST failure", async () => {
		const deploymentId = await setupEligibleDeployment();
		await setSchedule(deploymentId, { enabled: true, intervalHours: 6, anchorTime: "02:00" });

		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith("https://runner.example.com")) {
				throw new TypeError("network down");
			}
			return originalFetch(input, init);
		});

		const tickAt = new Date();
		const result = await runDueSchedules(envForTest(), tickAt);

		expect(result.attempted).toBe(1);
		expect(result.failed).toBe(1);
		expect(result.succeeded).toBe(0);

		const jobs = await listMigrationJobs({ deploymentId, limit: 10, offset: 0 });
		expect(jobs.length).toBe(0);

		const after = await getSchedule(deploymentId);
		expect(after?.lastStatus).toBe("retry_pending");
		expect(after?.retryAttemptsRemaining).toBe(1);
		const expectedNext = tickAt.getTime() + 5 * 60 * 1000;
		expect(Math.abs((after?.nextRunAt?.getTime() ?? 0) - expectedNext)).toBeLessThan(2000);
	});

	it("marks schedule failed, pushes next_run_at by interval, and sends alert when retry exhausted", async () => {
		const deploymentId = await setupEligibleDeployment();
		await setSchedule(deploymentId, { enabled: true, intervalHours: 6, anchorTime: "02:00" });
		await updateScheduleAfterRun(deploymentId, {
			lastRunAt: new Date(Date.now() - 60_000),
			nextRunAt: new Date(Date.now() - 1000),
			lastStatus: "retry_pending",
			retryAttemptsRemaining: 1,
		});

		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith("https://runner.example.com")) {
				throw new TypeError("network still down");
			}
			if (url.startsWith("https://api.telegram.org") || url.startsWith("https://api.resend.com")) {
				return new Response("{}", { status: 200 });
			}
			return originalFetch(input, init);
		});

		const tickAt = new Date();
		const result = await runDueSchedules(envForTest(), tickAt);

		expect(result.attempted).toBe(1);
		expect(result.failed).toBe(1);

		const after = await getSchedule(deploymentId);
		expect(after?.lastStatus).toBe("failed");
		expect(after?.retryAttemptsRemaining).toBe(0);
		const expectedNext = tickAt.getTime() + 6 * 60 * 60 * 1000;
		expect(Math.abs((after?.nextRunAt?.getTime() ?? 0) - expectedNext)).toBeLessThan(2000);

		const calls = fetchSpy.mock.calls;
		const tgCall = calls.find((c: Parameters<typeof fetch>) => String(c[0]).startsWith("https://api.telegram.org"));
		const mailCall = calls.find((c: Parameters<typeof fetch>) => String(c[0]).startsWith("https://api.resend.com"));
		expect(tgCall).toBeDefined();
		expect(mailCall).toBeDefined();
	});

	it("does NOT send alert on first transient failure (only retry_pending)", async () => {
		const deploymentId = await setupEligibleDeployment();
		await setSchedule(deploymentId, { enabled: true, intervalHours: 6, anchorTime: "02:00" });

		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith("https://runner.example.com")) {
				throw new TypeError("network down");
			}
			if (url.startsWith("https://api.telegram.org") || url.startsWith("https://api.resend.com")) {
				return new Response("{}", { status: 200 });
			}
			return originalFetch(input, init);
		});

		const tickAt = new Date();
		await runDueSchedules(envForTest(), tickAt);

		const after = await getSchedule(deploymentId);
		expect(after?.lastStatus).toBe("retry_pending");

		const calls = fetchSpy.mock.calls;
		expect(calls.find((c: Parameters<typeof fetch>) => String(c[0]).startsWith("https://api.telegram.org"))).toBeUndefined();
		expect(calls.find((c: Parameters<typeof fetch>) => String(c[0]).startsWith("https://api.resend.com"))).toBeUndefined();
	});

	it("resets retry counter and marks ok after a successful run following a pending retry", async () => {
		const deploymentId = await setupEligibleDeployment();
		await setSchedule(deploymentId, { enabled: true, intervalHours: 6, anchorTime: "02:00" });
		await updateScheduleAfterRun(deploymentId, {
			lastRunAt: new Date(Date.now() - 60_000),
			nextRunAt: new Date(Date.now() - 1000),
			lastStatus: "retry_pending",
			retryAttemptsRemaining: 1,
		});

		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === "https://runner.example.com/jobs/scheduled-cycle") {
				return new Response(JSON.stringify({ jobId: "11111111-1111-4111-8111-111111111111" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return originalFetch(input, init);
		});

		const tickAt = new Date();
		const result = await runDueSchedules(envForTest(), tickAt);

		expect(result.succeeded).toBe(1);
		expect(result.failed).toBe(0);

		const after = await getSchedule(deploymentId);
		expect(after?.lastStatus).toBe("ok");
		expect(after?.retryAttemptsRemaining).toBe(0);
	});

	it("when includeGdriveRestore=true and workspace OAuth present, POSTs scheduled-cycle with gdriveRestore payload", async () => {
		const deploymentId = await setupEligibleDeployment();
		// Add workspace (company drive) OAuth token
		const workspaceToken = {
			access_token: "company-access-token",
			refresh_token: "company-refresh-token",
			expiry_date: Date.now() + 60 * 60 * 1000,
		};
		await setWorkspaceOAuthToken(
			deploymentId,
			await encrypt(JSON.stringify(workspaceToken), encryptionKey()),
		);
		await setSchedule(deploymentId, {
			enabled: true,
			intervalHours: 24,
			anchorTime: "02:00",
			includeGdriveRestore: true,
		});

		let capturedBody: unknown;
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === "https://runner.example.com/jobs/scheduled-cycle") {
				capturedBody = JSON.parse(init?.body as string);
				return new Response(JSON.stringify({ jobId: "11111111-1111-4111-8111-111111111111" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return originalFetch(input, init);
		});

		const result = await runDueSchedules(envForTest(), new Date());
		expect(result.succeeded).toBe(1);

		const body = capturedBody as {
			gdriveRestore?: {
				gdrive: { accessToken: string; clientId: string };
				targets: Array<{ account: string; targetFolder: string }>;
			};
		};
		expect(body.gdriveRestore).toBeDefined();
		expect(body.gdriveRestore?.gdrive.accessToken).toBe("company-access-token");
		expect(body.gdriveRestore?.gdrive.clientId).toBe("test-google-client-id");
		expect(body.gdriveRestore?.targets).toEqual([
			{ account: "alice@example.com", targetFolder: "alice@example.com" },
		]);
	});

	it("when includeGdriveRestore=true but workspace OAuth missing, fails with CONFIG_INCOMPLETE_COMPANY_DRIVE and skips runner POST", async () => {
		const deploymentId = await setupEligibleDeployment();
		// NO setWorkspaceOAuthToken — company drive creds intentionally missing
		await setSchedule(deploymentId, {
			enabled: true,
			intervalHours: 24,
			anchorTime: "02:00",
			includeGdriveRestore: true,
		});

		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith("https://runner.example.com")) {
				return new Response(JSON.stringify({ jobId: "33333333-3333-4333-8333-333333333333" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return originalFetch(input, init);
		});

		const result = await runDueSchedules(envForTest(), new Date());

		expect(result.attempted).toBe(1);
		expect(result.failed).toBe(1);
		expect(result.succeeded).toBe(0);

		const runnerCalls = fetchSpy.mock.calls.filter((c: Parameters<typeof fetch>) =>
			String(c[0]).startsWith("https://runner.example.com/jobs/scheduled-cycle"),
		);
		expect(runnerCalls.length).toBe(0);

		const after = await getSchedule(deploymentId);
		expect(after?.lastStatus).toContain("CONFIG_INCOMPLETE_COMPANY_DRIVE");
	});

	it("when CONFIG_INCOMPLETE_COMPANY_DRIVE fires, sends Telegram + email failure alert", async () => {
		const deploymentId = await setupEligibleDeployment();
		// NO workspace OAuth — triggers CONFIG_INCOMPLETE_COMPANY_DRIVE
		await setSchedule(deploymentId, {
			enabled: true,
			intervalHours: 24,
			anchorTime: "02:00",
			includeGdriveRestore: true,
		});

		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith("https://api.telegram.org") || url.startsWith("https://api.resend.com")) {
				return new Response("{}", { status: 200 });
			}
			return originalFetch(input, init);
		});

		const result = await runDueSchedules(envForTest(), new Date());
		expect(result.failed).toBe(1);

		const calls = fetchSpy.mock.calls;
		expect(calls.find((c: Parameters<typeof fetch>) => String(c[0]).startsWith("https://api.telegram.org"))).toBeDefined();
		expect(calls.find((c: Parameters<typeof fetch>) => String(c[0]).startsWith("https://api.resend.com"))).toBeDefined();
	});

	it("when includeGdriveRestore=false, POSTs scheduled-cycle WITHOUT gdriveRestore payload", async () => {
		const deploymentId = await setupEligibleDeployment();
		await setSchedule(deploymentId, {
			enabled: true,
			intervalHours: 24,
			anchorTime: "02:00",
			includeGdriveRestore: false,
		});

		let capturedBody: unknown;
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === "https://runner.example.com/jobs/scheduled-cycle") {
				capturedBody = JSON.parse(init?.body as string);
				return new Response(JSON.stringify({ jobId: "22222222-2222-4222-8222-222222222222" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return originalFetch(input, init);
		});

		const result = await runDueSchedules(envForTest(), new Date());
		expect(result.succeeded).toBe(1);

		const body = capturedBody as { gdriveRestore?: unknown };
		expect(body.gdriveRestore).toBeUndefined();
	});

	it("counts schedule as failed when runner config is missing, leaves next_run_at untouched", async () => {
		const deployment = await createTestDeployment();
		await setSchedule(deployment.id, { enabled: true, intervalHours: 24, anchorTime: "02:00" });
		const before = await getSchedule(deployment.id);

		const result = await runDueSchedules(envForTest(), new Date());

		expect(result.attempted).toBe(1);
		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(1);

		const after = await getSchedule(deployment.id);
		expect(after?.nextRunAt?.getTime()).toBe(before?.nextRunAt?.getTime());
	});
});
