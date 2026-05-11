import { randomUUID } from "node:crypto";
import {
	type ServerConfig,
	setDeploymentServerConfig,
	updateDeployment,
} from "@repo/data-ops/deployment";
import { createEmployee, setDriveOAuthToken } from "@repo/data-ops/employee";
import { encrypt, encryptServerConfig } from "@repo/data-ops/encryption";
import { createFolderSelections } from "@repo/data-ops/folder-selection";
import { createMigrationJob, getMigrationJob } from "@repo/data-ops/migration";
import { upsertSharedDrives } from "@repo/data-ops/shared-drive";
import { createTestDeployment, createTestUser } from "@repo/data-ops/test-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerIngest } from "./migration-service";

const fullConfig: ServerConfig = {
	backup_path: "client",
	bwlimit: "08:00,5M",
	runner_url: "https://runner.example.com",
	runner_token: "secret-token",
};

function encryptionKey(): string {
	const key = process.env.ENCRYPTION_KEY;
	if (!key) throw new Error("ENCRYPTION_KEY not set");
	return key;
}

interface ReadyFixture {
	deploymentId: string;
	employeeId: string;
	sharedDriveId: string;
}

async function setupReadyDeploymentWithEmployee(): Promise<ReadyFixture> {
	const deployment = await createTestDeployment();
	await updateDeployment(deployment.id, {
		b2Config: {
			key_id: "K001abcdefgh",
			app_key: "K001secretappkey",
			bucket_prefix: "test-bucket",
		},
	});
	await setDeploymentServerConfig(
		deployment.id,
		await encryptServerConfig(fullConfig, encryptionKey()),
	);
	const sds = await upsertSharedDrives(deployment.id, [
		{ name: "ClientX SD", googleDriveId: "0ABC-shared-drive-123" },
	]);
	const sharedDriveId = sds[0]?.id;
	if (!sharedDriveId) throw new Error("Shared drive insert failed");

	const employee = await createEmployee(deployment.id, {
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
	await createFolderSelections(employee.id, [
		{
			itemId: "folder-1",
			itemName: "Reports",
			itemType: "folder",
			parentFolderId: "0ROOT",
			mimeType: "application/vnd.google-apps.folder",
			sharedDriveId,
		},
		{
			itemId: "file-1",
			itemName: "summary.docx",
			itemType: "file",
			parentFolderId: "folder-1",
			mimeType: "application/vnd.google-apps.document",
			sharedDriveId: null,
		},
	]);

	return { deploymentId: deployment.id, employeeId: employee.id, sharedDriveId };
}

describe("triggerIngest (integration)", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});
	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it("posts to runner /jobs/ingest with employee token + folder selections + persists job", async () => {
		const { deploymentId, employeeId } = await setupReadyDeploymentWithEmployee();
		const user = await createTestUser();
		const runnerJobId = randomUUID();
		let capturedBody: unknown;
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://runner.example.com/jobs/ingest") {
				capturedBody = JSON.parse(init?.body as string);
				return new Response(JSON.stringify({ jobId: runnerJobId }), {
					status: 202,
					headers: { "content-type": "application/json" },
				});
			}
			return originalFetch(input, init);
		});

		const result = await triggerIngest({
			deploymentId,
			employeeId,
			triggeredByUserId: user.id,
			env: {
				ENCRYPTION_KEY: encryptionKey(),
				GOOGLE_CLIENT_ID: "test-client-id",
				GOOGLE_CLIENT_SECRET: "test-client-secret",
			} as unknown as Env,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.data.type).toBe("ingest");
		expect(result.data.account).toBe("alice@example.com");
		expect(result.data.runnerJobId).toBe(runnerJobId);

		const persisted = await getMigrationJob(result.data.id);
		expect(persisted?.type).toBe("ingest");

		const body = capturedBody as {
			account: string;
			gdrive: { accessToken: string; clientId: string; clientSecret: string };
			runnerConfig: { bucketPrefix: string };
			folders: Array<{
				itemId: string;
				itemType: string;
				sharedDriveName: string | null;
			}>;
		};
		expect(body.account).toBe("alice@example.com");
		expect(body.gdrive.accessToken).toBe("employee-access-token");
		expect(body.gdrive.clientId).toBe("test-client-id");
		expect(body.gdrive.clientSecret).toBe("test-client-secret");
		expect(body.runnerConfig.bucketPrefix).toBe("test-bucket");
		expect(body.folders).toHaveLength(2);
		const folder = body.folders.find((f) => f.itemId === "folder-1");
		const file = body.folders.find((f) => f.itemId === "file-1");
		expect(folder?.sharedDriveName).toBe("ClientX SD");
		expect(file?.sharedDriveName).toBeNull();
	});

	it("returns EMPLOYEE_NOT_FOUND when employeeId does not exist", async () => {
		const { deploymentId } = await setupReadyDeploymentWithEmployee();
		const user = await createTestUser();
		const result = await triggerIngest({
			deploymentId,
			employeeId: randomUUID(),
			triggeredByUserId: user.id,
			env: {
				ENCRYPTION_KEY: encryptionKey(),
				GOOGLE_CLIENT_ID: "id",
				GOOGLE_CLIENT_SECRET: "secret",
			} as unknown as Env,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("EMPLOYEE_NOT_FOUND");
	});

	it("returns EMPLOYEE_NOT_FOUND when employee belongs to different deployment", async () => {
		const a = await setupReadyDeploymentWithEmployee();
		const b = await setupReadyDeploymentWithEmployee();
		const user = await createTestUser();
		const result = await triggerIngest({
			deploymentId: a.deploymentId,
			employeeId: b.employeeId, // mismatched deployment
			triggeredByUserId: user.id,
			env: {
				ENCRYPTION_KEY: encryptionKey(),
				GOOGLE_CLIENT_ID: "id",
				GOOGLE_CLIENT_SECRET: "secret",
			} as unknown as Env,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("EMPLOYEE_NOT_FOUND");
	});

	it("returns NO_EMPLOYEE_TOKEN when employee has no driveOauthToken", async () => {
		const deployment = await createTestDeployment();
		await updateDeployment(deployment.id, {
			b2Config: {
				key_id: "K001abcdefgh",
				app_key: "K001secretappkey",
				bucket_prefix: "test-bucket",
			},
		});
		await setDeploymentServerConfig(
			deployment.id,
			await encryptServerConfig(fullConfig, encryptionKey()),
		);
		const sds = await upsertSharedDrives(deployment.id, [{ name: "SD", googleDriveId: "0XYZ" }]);
		const sharedDriveId = sds[0]?.id;
		if (!sharedDriveId) throw new Error("SD insert failed");
		const employee = await createEmployee(deployment.id, {
			email: "no-token@example.com",
			name: "NoToken",
		});
		// no setDriveOAuthToken
		await createFolderSelections(employee.id, [
			{
				itemId: "x",
				itemName: "X",
				itemType: "folder",
				parentFolderId: "0",
				mimeType: null,
				sharedDriveId,
			},
		]);
		const user = await createTestUser();

		const result = await triggerIngest({
			deploymentId: deployment.id,
			employeeId: employee.id,
			triggeredByUserId: user.id,
			env: {
				ENCRYPTION_KEY: encryptionKey(),
				GOOGLE_CLIENT_ID: "id",
				GOOGLE_CLIENT_SECRET: "secret",
			} as unknown as Env,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("NO_EMPLOYEE_TOKEN");
	});

	it("returns NO_FOLDERS_SELECTED when employee has zero folder selections", async () => {
		const deployment = await createTestDeployment();
		await updateDeployment(deployment.id, {
			b2Config: {
				key_id: "K001abcdefgh",
				app_key: "K001secretappkey",
				bucket_prefix: "test-bucket",
			},
		});
		await setDeploymentServerConfig(
			deployment.id,
			await encryptServerConfig(fullConfig, encryptionKey()),
		);
		const employee = await createEmployee(deployment.id, {
			email: "empty@example.com",
			name: "Empty",
		});
		const tokenPayload = {
			access_token: "t",
			refresh_token: "r",
			expiry_date: Date.now() + 60 * 60 * 1000,
		};
		await setDriveOAuthToken(
			employee.id,
			await encrypt(JSON.stringify(tokenPayload), encryptionKey()),
		);
		// no folder selections
		const user = await createTestUser();

		const result = await triggerIngest({
			deploymentId: deployment.id,
			employeeId: employee.id,
			triggeredByUserId: user.id,
			env: {
				ENCRYPTION_KEY: encryptionKey(),
				GOOGLE_CLIENT_ID: "id",
				GOOGLE_CLIENT_SECRET: "secret",
			} as unknown as Env,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("NO_FOLDERS_SELECTED");
	});

	it("returns JOB_ALREADY_RUNNING when another migration job is active for the deployment", async () => {
		const { deploymentId, employeeId } = await setupReadyDeploymentWithEmployee();
		const user = await createTestUser();
		await createMigrationJob({
			deploymentId,
			type: "backup",
			account: null,
			dryRun: false,
			runnerJobId: randomUUID(),
			triggeredByUserId: user.id,
		});

		const result = await triggerIngest({
			deploymentId,
			employeeId,
			triggeredByUserId: user.id,
			env: {
				ENCRYPTION_KEY: encryptionKey(),
				GOOGLE_CLIENT_ID: "id",
				GOOGLE_CLIENT_SECRET: "secret",
			} as unknown as Env,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("JOB_ALREADY_RUNNING");
	});
});
