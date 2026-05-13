import { recordServerConfigChange } from "@repo/data-ops/audit-log";
import type { Deployment } from "@repo/data-ops/deployment";
import {
	getDeployment,
	getDeploymentServerConfig,
	getWorkspaceOAuthToken,
	type ServerConfig,
	setDeploymentServerConfig,
	setWorkspaceOAuthToken,
} from "@repo/data-ops/deployment";
import {
	getDriveOAuthToken,
	getEmployeeById,
	getEmployeesByDeployment,
	setDriveOAuthToken,
} from "@repo/data-ops/employee";
import {
	decrypt,
	decryptServerConfig,
	encrypt,
	encryptServerConfig,
	maskSecret,
} from "@repo/data-ops/encryption";
import { getFolderSelectionsByEmployee } from "@repo/data-ops/folder-selection";
import {
	createMigrationJob,
	getActiveMigrationJob,
	getMigrationJob,
	JobCreatedResponseSchema,
	listMigrationJobs,
	type MigrationJob,
	type RunnerJobConfig,
	RunnerJobSchema,
	type ScheduledCycleEmployee,
	type ScheduledCycleRestore,
	updateMigrationJobStatus,
} from "@repo/data-ops/migration";
import { getSchedule } from "@repo/data-ops/schedule";
import { getSharedDrivesByDeployment } from "@repo/data-ops/shared-drive";
import type { Result } from "../types/result";
import { isSuccessNotificationEnabled, notifyJobFailed, notifyJobSucceeded } from "./alert-service";
import { buildRestoreTargets } from "./build-restore-targets";

const NOT_FOUND = {
	ok: false as const,
	error: {
		code: "NOT_FOUND",
		message: "Wdrozenie nie zostalo znalezione",
		status: 404,
	},
};

const CONFIG_INCOMPLETE_B2 = {
	ok: false as const,
	error: {
		code: "CONFIG_INCOMPLETE",
		message: "Brak konfiguracji B2 lub backup_path na wdrozeniu",
		status: 400,
	},
};

const JOB_ALREADY_RUNNING = {
	ok: false as const,
	error: {
		code: "JOB_ALREADY_RUNNING",
		message: "Inny job migracji jest juz aktywny dla tego wdrozenia",
		status: 409,
	},
};

function sanitizeEmailForPath(email: string): string {
	return email.replace(/[@.]/g, "_");
}

function buildRunnerJobConfig(
	deployment: Deployment,
	serverConfig: ServerConfig,
	backupIncludeAccounts?: string[],
): RunnerJobConfig | null {
	const b2 = deployment.b2Config;
	const backupPath = serverConfig.backup_path;
	if (!b2 || !backupPath) return null;
	const cfg: RunnerJobConfig = {
		b2KeyId: b2.key_id,
		b2AppKey: b2.app_key,
		bucketPrefix: b2.bucket_prefix,
		backupPath,
	};
	if (serverConfig.bwlimit) cfg.bwlimit = serverConfig.bwlimit;
	if (backupIncludeAccounts && backupIncludeAccounts.length > 0) {
		cfg.backupIncludeAccounts = backupIncludeAccounts;
	}
	return cfg;
}

export async function getServerConfigForAdmin(
	deploymentId: string,
	encryptionKey: string,
): Promise<Result<ServerConfig | null>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) return NOT_FOUND;

	const stored = await getDeploymentServerConfig(deploymentId);
	if (!stored) return { ok: true, data: null };

	const decrypted = await decryptServerConfig(stored, encryptionKey);
	const masked: ServerConfig = {
		...decrypted,
		...(decrypted.runner_token ? { runner_token: maskSecret(decrypted.runner_token) } : {}),
	};
	return { ok: true, data: masked };
}

export type RunnerVerifyResult = { ok: boolean; error?: string };

export async function testRunnerConnection(
	deploymentId: string,
	encryptionKey: string,
): Promise<Result<RunnerVerifyResult>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) return NOT_FOUND;

	const stored = await getDeploymentServerConfig(deploymentId);
	const config = stored ? await decryptServerConfig(stored, encryptionKey) : null;
	if (!config?.runner_url || !config.runner_token) {
		return {
			ok: false,
			error: {
				code: "CONFIG_INCOMPLETE",
				message: "Brak runner_url lub runner_token w konfiguracji",
				status: 400,
			},
		};
	}
	if (!deployment.b2Config) {
		return {
			ok: false,
			error: {
				code: "CONFIG_INCOMPLETE",
				message: "Brak konfiguracji B2",
				status: 400,
			},
		};
	}

	try {
		const response = await fetch(`${config.runner_url}/verify`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${config.runner_token}`,
			},
			body: JSON.stringify({
				b2KeyId: deployment.b2Config.key_id,
				b2AppKey: deployment.b2Config.app_key,
				bucketPrefix: deployment.b2Config.bucket_prefix,
			}),
		});
		const data = (await response.json()) as RunnerVerifyResult;
		return { ok: true, data };
	} catch (_err) {
		return {
			ok: false,
			error: {
				code: "RUNNER_UNREACHABLE",
				message: "Nie udalo sie polaczyc z runnerem",
				status: 502,
			},
		};
	}
}

export interface TriggerBackupInput {
	deploymentId: string;
	account?: string;
	triggeredByUserId: string;
	encryptionKey: string;
}

export async function triggerBackup(input: TriggerBackupInput): Promise<Result<MigrationJob>> {
	const deployment = await getDeployment(input.deploymentId);
	if (!deployment) return NOT_FOUND;

	const active = await getActiveMigrationJob(input.deploymentId);
	if (active) return JOB_ALREADY_RUNNING;

	const stored = await getDeploymentServerConfig(input.deploymentId);
	const config = stored ? await decryptServerConfig(stored, input.encryptionKey) : null;
	if (!config?.runner_url || !config.runner_token) {
		return {
			ok: false,
			error: {
				code: "CONFIG_INCOMPLETE",
				message: "Brak runner_url lub runner_token w konfiguracji",
				status: 400,
			},
		};
	}

	const backupAccounts = input.account
		? [sanitizeEmailForPath(input.account)]
		: (await getEmployeesByDeployment(input.deploymentId)).map((e) =>
				sanitizeEmailForPath(e.email),
			);
	const runnerConfig = buildRunnerJobConfig(deployment, config, backupAccounts);
	if (!runnerConfig) return CONFIG_INCOMPLETE_B2;

	const requestBody: { account?: string; runnerConfig: RunnerJobConfig } = { runnerConfig };
	if (input.account) requestBody.account = input.account;

	let response: Response;
	try {
		response = await fetch(`${config.runner_url}/jobs/backup`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${config.runner_token}`,
			},
			body: JSON.stringify(requestBody),
		});
	} catch (_err) {
		return {
			ok: false,
			error: {
				code: "RUNNER_UNREACHABLE",
				message: "Nie udalo sie polaczyc z runnerem",
				status: 502,
			},
		};
	}

	if (!response.ok) {
		return {
			ok: false,
			error: {
				code: "RUNNER_REJECTED",
				message: `Runner odrzucil zadanie (${response.status})`,
				status: 502,
			},
		};
	}

	const parsed = JobCreatedResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		return {
			ok: false,
			error: {
				code: "RUNNER_INVALID_RESPONSE",
				message: "Runner zwrocil nieprawidlowa odpowiedz",
				status: 502,
			},
		};
	}

	const job = await createMigrationJob({
		deploymentId: input.deploymentId,
		type: "backup",
		account: input.account ?? null,
		dryRun: false,
		runnerJobId: parsed.data.jobId,
		triggeredByUserId: input.triggeredByUserId,
	});

	return { ok: true, data: job };
}

export interface TriggerScheduledCycleInput {
	deploymentId: string;
	triggeredByUserId: string;
	triggeredByCron?: boolean;
	env: Env;
}

export async function triggerScheduledCycle(
	input: TriggerScheduledCycleInput,
): Promise<Result<MigrationJob>> {
	const { deploymentId, triggeredByUserId, env } = input;

	const deployment = await getDeployment(deploymentId);
	if (!deployment) return NOT_FOUND;

	const active = await getActiveMigrationJob(deploymentId);
	if (active) return JOB_ALREADY_RUNNING;

	const stored = await getDeploymentServerConfig(deploymentId);
	const config = stored ? await decryptServerConfig(stored, env.ENCRYPTION_KEY) : null;
	if (!config?.runner_url || !config.runner_token) {
		return {
			ok: false,
			error: {
				code: "CONFIG_INCOMPLETE",
				message: "Brak runner_url lub runner_token w konfiguracji",
				status: 400,
			},
		};
	}

	const allEmployees = await getEmployeesByDeployment(deploymentId);
	if (allEmployees.length === 0) {
		return {
			ok: false,
			error: {
				code: "NO_EMPLOYEES",
				message: "Brak pracownikow we wdrozeniu",
				status: 400,
			},
		};
	}

	const runnerConfig = buildRunnerJobConfig(
		deployment,
		config,
		allEmployees.map((e) => sanitizeEmailForPath(e.email)),
	);
	if (!runnerConfig) return CONFIG_INCOMPLETE_B2;

	const sharedDrives = await getSharedDrivesByDeployment(deploymentId);
	const sdNameById = new Map(sharedDrives.map((sd) => [sd.id, sd.name]));
	const sdGoogleIdByDbId = new Map(sharedDrives.map((sd) => [sd.id, sd.googleDriveId ?? null]));

	const cycleEmployees: ScheduledCycleEmployee[] = [];
	let eligibleCount = 0;
	for (const employee of allEmployees) {
		if (employee.oauthStatus !== "authorized") {
			cycleEmployees.push({
				account: employee.email,
				gdrive: null,
				folders: [],
				skipReason: "no_oauth",
			});
			continue;
		}
		if (employee.selectionStatus !== "completed") {
			cycleEmployees.push({
				account: employee.email,
				gdrive: null,
				folders: [],
				skipReason: "no_selection",
			});
			continue;
		}
		const gdriveResult = await buildEmployeeGDriveCredentialsForRunner(employee.id, env);
		if (!gdriveResult.ok) {
			cycleEmployees.push({
				account: employee.email,
				gdrive: null,
				folders: [],
				skipReason: "oauth_refresh_failed",
			});
			continue;
		}
		const selections = await getFolderSelectionsByEmployee(employee.id);
		if (selections.length === 0) {
			cycleEmployees.push({
				account: employee.email,
				gdrive: gdriveResult.data,
				folders: [],
				skipReason: "no_folders",
			});
			continue;
		}
		const folders = selections.map((s) => ({
			itemId: s.itemId,
			itemName: s.itemName,
			itemType: s.itemType,
			parentFolderId: s.parentFolderId,
			mimeType: s.mimeType,
			sharedDriveName: s.sharedDriveId ? (sdNameById.get(s.sharedDriveId) ?? null) : null,
			sharedDriveId: s.sharedDriveId ? (sdGoogleIdByDbId.get(s.sharedDriveId) ?? null) : null,
		}));
		cycleEmployees.push({ account: employee.email, gdrive: gdriveResult.data, folders });
		eligibleCount++;
	}

	if (eligibleCount === 0) {
		return {
			ok: false,
			error: {
				code: "NO_ELIGIBLE_EMPLOYEES",
				message: "Brak pracownikow gotowych do migracji (OAuth + foldery)",
				status: 400,
			},
		};
	}

	const schedule = await getSchedule(deploymentId);
	let gdriveRestore: ScheduledCycleRestore | undefined;
	if (schedule?.includeGdriveRestore) {
		const companyGDrive = await buildGDriveCredentialsForRunner(deploymentId, env);
		if (!companyGDrive.ok) {
			return {
				ok: false,
				error: {
					code: "CONFIG_INCOMPLETE_COMPANY_DRIVE",
					message: "Brak konfiguracji dysku firmowego - uzupelnij OAuth",
					status: 400,
				},
			};
		}
		const restoreSharedDriveId =
			sharedDrives.find((d) => d.googleDriveId)?.googleDriveId ?? null;
		if (!restoreSharedDriveId) {
			return {
				ok: false,
				error: {
					code: "NO_SHARED_DRIVE",
					message:
						"Brak shared drive dla wdrozenia. Skonfiguruj shared drive w panelu admina.",
					status: 400,
				},
			};
		}
		const eligibleAccounts = cycleEmployees
			.filter((e) => e.gdrive !== null && e.folders.length > 0)
			.map((e) => ({ account: e.account }));
		if (eligibleAccounts.length > 0) {
			gdriveRestore = {
				gdrive: { ...companyGDrive.data, sharedDriveId: restoreSharedDriveId },
				targets: buildRestoreTargets(eligibleAccounts),
			};
		}
	}

	const requestBody = gdriveRestore
		? { runnerConfig, employees: cycleEmployees, gdriveRestore }
		: { runnerConfig, employees: cycleEmployees };

	let response: Response;
	try {
		response = await fetch(`${config.runner_url}/jobs/scheduled-cycle`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${config.runner_token}`,
			},
			body: JSON.stringify(requestBody),
		});
	} catch (_err) {
		return {
			ok: false,
			error: {
				code: "RUNNER_UNREACHABLE",
				message: "Nie udalo sie polaczyc z runnerem",
				status: 502,
			},
		};
	}

	if (!response.ok) {
		return {
			ok: false,
			error: {
				code: "RUNNER_REJECTED",
				message: `Runner odrzucil zadanie (${response.status})`,
				status: 502,
			},
		};
	}

	const parsed = JobCreatedResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		return {
			ok: false,
			error: {
				code: "RUNNER_INVALID_RESPONSE",
				message: "Runner zwrocil nieprawidlowa odpowiedz",
				status: 502,
			},
		};
	}

	const job = await createMigrationJob({
		deploymentId,
		type: "scheduled-cycle",
		account: null,
		dryRun: false,
		runnerJobId: parsed.data.jobId,
		triggeredByUserId,
		triggeredByCron: input.triggeredByCron ?? false,
	});

	return { ok: true, data: job };
}

export interface TriggerMigrateInput {
	deploymentId: string;
	account?: string;
	dryRun?: boolean;
	triggeredByUserId: string;
	encryptionKey: string;
}

export async function triggerMigrate(input: TriggerMigrateInput): Promise<Result<MigrationJob>> {
	const deployment = await getDeployment(input.deploymentId);
	if (!deployment) return NOT_FOUND;

	const active = await getActiveMigrationJob(input.deploymentId);
	if (active) return JOB_ALREADY_RUNNING;

	const stored = await getDeploymentServerConfig(input.deploymentId);
	const config = stored ? await decryptServerConfig(stored, input.encryptionKey) : null;
	if (!config?.runner_url || !config.runner_token) {
		return {
			ok: false,
			error: {
				code: "CONFIG_INCOMPLETE",
				message: "Brak runner_url lub runner_token w konfiguracji",
				status: 400,
			},
		};
	}

	const runnerConfig = buildRunnerJobConfig(deployment, config);
	if (!runnerConfig) return CONFIG_INCOMPLETE_B2;

	const dryRun = input.dryRun ?? false;
	const requestBody: { account?: string; dryRun: boolean; runnerConfig: RunnerJobConfig } = {
		dryRun,
		runnerConfig,
	};
	if (input.account) requestBody.account = input.account;

	let response: Response;
	try {
		response = await fetch(`${config.runner_url}/jobs/migrate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${config.runner_token}`,
			},
			body: JSON.stringify(requestBody),
		});
	} catch (_err) {
		return {
			ok: false,
			error: {
				code: "RUNNER_UNREACHABLE",
				message: "Nie udalo sie polaczyc z runnerem",
				status: 502,
			},
		};
	}

	if (!response.ok) {
		return {
			ok: false,
			error: {
				code: "RUNNER_REJECTED",
				message: `Runner odrzucil zadanie (${response.status})`,
				status: 502,
			},
		};
	}

	const parsed = JobCreatedResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		return {
			ok: false,
			error: {
				code: "RUNNER_INVALID_RESPONSE",
				message: "Runner zwrocil nieprawidlowa odpowiedz",
				status: 502,
			},
		};
	}

	const job = await createMigrationJob({
		deploymentId: input.deploymentId,
		type: "migrate",
		account: input.account ?? null,
		dryRun,
		runnerJobId: parsed.data.jobId,
		triggeredByUserId: input.triggeredByUserId,
	});

	return { ok: true, data: job };
}

interface GDriveCredentialsForRunner {
	clientId: string;
	clientSecret: string;
	accessToken: string;
	refreshToken: string;
	expiry: string;
}

interface WorkspaceTokenPayload {
	access_token: string;
	refresh_token: string;
	expiry_date: number;
}

interface GDriveTokenSource {
	load: () => Promise<string | null>;
	save: (encrypted: string) => Promise<void>;
	missingCode: string;
	missingMessage: string;
	decryptMessage: string;
	refreshMessage: string;
}

async function buildGDriveCredentialsFromSource(
	source: GDriveTokenSource,
	env: Env,
): Promise<Result<GDriveCredentialsForRunner>> {
	const encryptedToken = await source.load();
	if (!encryptedToken) {
		return {
			ok: false,
			error: { code: source.missingCode, message: source.missingMessage, status: 401 },
		};
	}

	let payload: WorkspaceTokenPayload;
	try {
		payload = JSON.parse(
			await decrypt(encryptedToken, env.ENCRYPTION_KEY),
		) as WorkspaceTokenPayload;
	} catch {
		return {
			ok: false,
			error: { code: "TOKEN_DECRYPT_FAILED", message: source.decryptMessage, status: 500 },
		};
	}

	if (Date.now() > payload.expiry_date) {
		const refreshResp = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: env.GOOGLE_CLIENT_ID,
				client_secret: env.GOOGLE_CLIENT_SECRET,
				refresh_token: payload.refresh_token,
				grant_type: "refresh_token",
			}),
		});
		if (!refreshResp.ok) {
			return {
				ok: false,
				error: {
					code: "TOKEN_REFRESH_FAILED",
					message: source.refreshMessage,
					status: 401,
				},
			};
		}
		const refreshData = (await refreshResp.json()) as {
			access_token: string;
			expires_in: number;
		};
		payload = {
			...payload,
			access_token: refreshData.access_token,
			expiry_date: Date.now() + refreshData.expires_in * 1000,
		};
		await source.save(await encrypt(JSON.stringify(payload), env.ENCRYPTION_KEY));
	}

	return {
		ok: true,
		data: {
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET,
			accessToken: payload.access_token,
			refreshToken: payload.refresh_token,
			expiry: new Date(payload.expiry_date).toISOString(),
		},
	};
}

function buildGDriveCredentialsForRunner(deploymentId: string, env: Env) {
	return buildGDriveCredentialsFromSource(
		{
			load: () => getWorkspaceOAuthToken(deploymentId),
			save: (encrypted) => setWorkspaceOAuthToken(deploymentId, encrypted),
			missingCode: "NO_WORKSPACE_TOKEN",
			missingMessage: "Brak autoryzacji Workspace. Przejdz przez krok 2 onboardingu.",
			decryptMessage: "Nie udalo sie odszyfrowac tokenu Workspace",
			refreshMessage: "Nie udalo sie odswiezyc tokenu Workspace",
		},
		env,
	);
}

export interface TriggerGDriveRestoreInput {
	deploymentId: string;
	account: string;
	triggeredByUserId: string;
	env: Env;
}

export async function triggerGDriveRestore(
	input: TriggerGDriveRestoreInput,
): Promise<Result<MigrationJob>> {
	const { deploymentId, account, triggeredByUserId, env } = input;

	const deployment = await getDeployment(deploymentId);
	if (!deployment) return NOT_FOUND;

	const active = await getActiveMigrationJob(deploymentId);
	if (active) return JOB_ALREADY_RUNNING;

	const stored = await getDeploymentServerConfig(deploymentId);
	const config = stored ? await decryptServerConfig(stored, env.ENCRYPTION_KEY) : null;
	if (!config?.runner_url || !config.runner_token) {
		return {
			ok: false,
			error: {
				code: "CONFIG_INCOMPLETE",
				message: "Brak runner_url lub runner_token w konfiguracji",
				status: 400,
			},
		};
	}

	const runnerConfig = buildRunnerJobConfig(deployment, config);
	if (!runnerConfig) return CONFIG_INCOMPLETE_B2;

	const sharedDrives = await getSharedDrivesByDeployment(deploymentId);
	const sharedDriveId = sharedDrives.find((d) => d.googleDriveId)?.googleDriveId ?? null;
	if (!sharedDriveId) {
		return {
			ok: false,
			error: {
				code: "NO_SHARED_DRIVE",
				message: "Brak shared drive dla wdrozenia. Skonfiguruj shared drive w panelu admina.",
				status: 400,
			},
		};
	}

	const gdriveResult = await buildGDriveCredentialsForRunner(deploymentId, env);
	if (!gdriveResult.ok) return gdriveResult;

	const requestBody = {
		account,
		runnerConfig,
		gdrive: { ...gdriveResult.data, sharedDriveId },
	};

	let response: Response;
	try {
		response = await fetch(`${config.runner_url}/jobs/gdrive-restore`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${config.runner_token}`,
			},
			body: JSON.stringify(requestBody),
		});
	} catch (_err) {
		return {
			ok: false,
			error: {
				code: "RUNNER_UNREACHABLE",
				message: "Nie udalo sie polaczyc z runnerem",
				status: 502,
			},
		};
	}

	if (!response.ok) {
		return {
			ok: false,
			error: {
				code: "RUNNER_REJECTED",
				message: `Runner odrzucil zadanie (${response.status})`,
				status: 502,
			},
		};
	}

	const parsed = JobCreatedResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		return {
			ok: false,
			error: {
				code: "RUNNER_INVALID_RESPONSE",
				message: "Runner zwrocil nieprawidlowa odpowiedz",
				status: 502,
			},
		};
	}

	const job = await createMigrationJob({
		deploymentId,
		type: "gdrive-restore",
		account,
		dryRun: false,
		runnerJobId: parsed.data.jobId,
		triggeredByUserId,
	});

	return { ok: true, data: job };
}

export async function getMigrationJobStatus(
	jobId: string,
	env: Env,
): Promise<Result<MigrationJob>> {
	const job = await getMigrationJob(jobId);
	if (!job) {
		return {
			ok: false,
			error: {
				code: "NOT_FOUND",
				message: "Zadanie migracji nie zostalo znalezione",
				status: 404,
			},
		};
	}
	if (job.status === "done" || job.status === "failed") {
		return { ok: true, data: job };
	}

	const stored = await getDeploymentServerConfig(job.deploymentId);
	const config = stored ? await decryptServerConfig(stored, env.ENCRYPTION_KEY) : null;
	if (!config?.runner_url || !config.runner_token) {
		return { ok: true, data: job };
	}

	let response: Response;
	try {
		response = await fetch(`${config.runner_url}/jobs/${job.runnerJobId}`, {
			headers: { authorization: `Bearer ${config.runner_token}` },
		});
	} catch (_err) {
		return { ok: true, data: job };
	}
	if (!response.ok) return { ok: true, data: job };

	const parsed = RunnerJobSchema.safeParse(await response.json());
	if (!parsed.success) return { ok: true, data: job };

	if (parsed.data.status === job.status) return { ok: true, data: job };

	const updated = await updateMigrationJobStatus(job.id, {
		status: parsed.data.status,
		exitCode: parsed.data.exitCode,
	});

	if (parsed.data.status === "failed" && job.type === "scheduled-cycle" && env.TELEGRAM_BOT_TOKEN) {
		const deployment = await getDeployment(job.deploymentId);
		const logTail = await fetchRunnerLogTail(
			config.runner_url,
			config.runner_token,
			job.runnerJobId,
		);
		await notifyJobFailed(
			{
				deploymentId: job.deploymentId,
				jobId: job.id,
				reason: "job_failed",
				clientName: deployment?.clientName ?? "(unknown)",
				exitCode: parsed.data.exitCode ?? null,
				logTail,
			},
			env,
		);
	}

	if (
		parsed.data.status === "done" &&
		job.type === "scheduled-cycle" &&
		env.TELEGRAM_BOT_TOKEN &&
		isSuccessNotificationEnabled(env)
	) {
		const deployment = await getDeployment(job.deploymentId);
		const startedAt = parsed.data.startedAt ? new Date(parsed.data.startedAt) : null;
		const finishedAt = parsed.data.finishedAt ? new Date(parsed.data.finishedAt) : null;
		const durationSeconds =
			startedAt && finishedAt
				? Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
				: null;
		await notifyJobSucceeded(
			{
				deploymentId: job.deploymentId,
				jobId: job.id,
				clientName: deployment?.clientName ?? "(unknown)",
				durationSeconds,
			},
			env,
		);
	}

	return { ok: true, data: updated ?? job };
}

async function fetchRunnerLogTail(
	runnerUrl: string,
	runnerToken: string,
	runnerJobId: string,
): Promise<string | null> {
	try {
		const resp = await fetch(`${runnerUrl}/jobs/${runnerJobId}/logs`, {
			headers: { authorization: `Bearer ${runnerToken}` },
		});
		if (!resp.ok) return null;
		const data = (await resp.json()) as { lines?: Array<{ text?: string; line?: string }> };
		const lines = data.lines ?? [];
		const last = lines.slice(-20).map((l) => l.text ?? l.line ?? "");
		return last.length > 0 ? last.join("\n") : null;
	} catch {
		return null;
	}
}

export async function streamJobLogs(
	jobId: string,
	encryptionKey: string,
): Promise<Result<Response>> {
	const job = await getMigrationJob(jobId);
	if (!job) {
		return {
			ok: false,
			error: {
				code: "NOT_FOUND",
				message: "Zadanie migracji nie zostalo znalezione",
				status: 404,
			},
		};
	}

	const stored = await getDeploymentServerConfig(job.deploymentId);
	const config = stored ? await decryptServerConfig(stored, encryptionKey) : null;
	if (!config?.runner_url || !config.runner_token) {
		return {
			ok: false,
			error: {
				code: "CONFIG_INCOMPLETE",
				message: "Brak runner_url lub runner_token w konfiguracji",
				status: 400,
			},
		};
	}

	try {
		const response = await fetch(`${config.runner_url}/jobs/${job.runnerJobId}/logs/stream`, {
			headers: { authorization: `Bearer ${config.runner_token}` },
		});
		return { ok: true, data: response };
	} catch (_err) {
		return {
			ok: false,
			error: {
				code: "RUNNER_UNREACHABLE",
				message: "Nie udalo sie polaczyc z runnerem",
				status: 502,
			},
		};
	}
}

export async function listMigrationJobsForAdmin(input: {
	deploymentId: string;
	limit: number;
	offset: number;
}): Promise<Result<MigrationJob[]>> {
	const jobs = await listMigrationJobs(input);
	return { ok: true, data: jobs };
}

export async function setServerConfigFromAdmin(
	deploymentId: string,
	partial: Partial<ServerConfig>,
	encryptionKey: string,
	triggeredByUserId?: string,
): Promise<Result<void>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) return NOT_FOUND;

	const existingEncrypted = await getDeploymentServerConfig(deploymentId);
	const existing = existingEncrypted
		? await decryptServerConfig(existingEncrypted, encryptionKey)
		: null;

	const merged: ServerConfig = {
		backup_path: partial.backup_path ?? existing?.backup_path ?? "",
		bwlimit: partial.bwlimit ?? existing?.bwlimit ?? "",
		...(partial.ssh_host !== undefined
			? { ssh_host: partial.ssh_host }
			: existing?.ssh_host
				? { ssh_host: existing.ssh_host }
				: {}),
		...(partial.ssh_user !== undefined
			? { ssh_user: partial.ssh_user }
			: existing?.ssh_user
				? { ssh_user: existing.ssh_user }
				: {}),
		...(partial.runner_url !== undefined
			? { runner_url: partial.runner_url }
			: existing?.runner_url
				? { runner_url: existing.runner_url }
				: {}),
		...(partial.runner_token !== undefined
			? { runner_token: partial.runner_token }
			: existing?.runner_token
				? { runner_token: existing.runner_token }
				: {}),
	};

	const changedFields = diffServerConfigFields(existing, merged);

	const encrypted = await encryptServerConfig(merged, encryptionKey);
	await setDeploymentServerConfig(deploymentId, encrypted);

	if (triggeredByUserId && changedFields.length > 0) {
		await recordServerConfigChange({
			deploymentId,
			userId: triggeredByUserId,
			changedFields,
		});
	}

	return { ok: true, data: undefined };
}

const SERVER_CONFIG_TRACKED_FIELDS = [
	"backup_path",
	"bwlimit",
	"ssh_host",
	"ssh_user",
	"runner_url",
	"runner_token",
] as const satisfies readonly (keyof ServerConfig)[];

function buildEmployeeGDriveCredentialsForRunner(employeeId: string, env: Env) {
	return buildGDriveCredentialsFromSource(
		{
			load: () => getDriveOAuthToken(employeeId),
			save: (encrypted) => setDriveOAuthToken(employeeId, encrypted),
			missingCode: "NO_EMPLOYEE_TOKEN",
			missingMessage: "Pracownik nie autoryzowal dostepu do Drive",
			decryptMessage: "Nie udalo sie odszyfrowac tokenu pracownika",
			refreshMessage: "Nie udalo sie odswiezyc tokenu pracownika",
		},
		env,
	);
}

export interface TriggerIngestInput {
	deploymentId: string;
	employeeId: string;
	triggeredByUserId: string;
	env: Env;
}

export async function triggerIngest(input: TriggerIngestInput): Promise<Result<MigrationJob>> {
	const { deploymentId, employeeId, triggeredByUserId, env } = input;

	const deployment = await getDeployment(deploymentId);
	if (!deployment) return NOT_FOUND;

	const employee = await getEmployeeById(employeeId);
	if (!employee || employee.deploymentId !== deploymentId) {
		return {
			ok: false,
			error: {
				code: "EMPLOYEE_NOT_FOUND",
				message: "Pracownik nie zostal znaleziony w tym wdrozeniu",
				status: 404,
			},
		};
	}

	const active = await getActiveMigrationJob(deploymentId);
	if (active) return JOB_ALREADY_RUNNING;

	const stored = await getDeploymentServerConfig(deploymentId);
	const config = stored ? await decryptServerConfig(stored, env.ENCRYPTION_KEY) : null;
	if (!config?.runner_url || !config.runner_token) {
		return {
			ok: false,
			error: {
				code: "CONFIG_INCOMPLETE",
				message: "Brak runner_url lub runner_token w konfiguracji",
				status: 400,
			},
		};
	}

	const runnerConfig = buildRunnerJobConfig(deployment, config);
	if (!runnerConfig) return CONFIG_INCOMPLETE_B2;

	const selections = await getFolderSelectionsByEmployee(employeeId);
	if (selections.length === 0) {
		return {
			ok: false,
			error: {
				code: "NO_FOLDERS_SELECTED",
				message: "Pracownik nie wybral zadnych folderow do migracji",
				status: 400,
			},
		};
	}

	const sharedDrives = await getSharedDrivesByDeployment(deploymentId);
	const sdNameById = new Map(sharedDrives.map((sd) => [sd.id, sd.name]));
	const sdGoogleIdByDbId = new Map(sharedDrives.map((sd) => [sd.id, sd.googleDriveId ?? null]));
	const folders = selections.map((s) => ({
		itemId: s.itemId,
		itemName: s.itemName,
		itemType: s.itemType,
		parentFolderId: s.parentFolderId,
		mimeType: s.mimeType,
		sharedDriveName: s.sharedDriveId ? (sdNameById.get(s.sharedDriveId) ?? null) : null,
		sharedDriveId: s.sharedDriveId ? (sdGoogleIdByDbId.get(s.sharedDriveId) ?? null) : null,
	}));

	const gdriveResult = await buildEmployeeGDriveCredentialsForRunner(employeeId, env);
	if (!gdriveResult.ok) return gdriveResult;

	const requestBody = {
		account: employee.email,
		runnerConfig,
		gdrive: gdriveResult.data,
		folders,
	};

	let response: Response;
	try {
		response = await fetch(`${config.runner_url}/jobs/ingest`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${config.runner_token}`,
			},
			body: JSON.stringify(requestBody),
		});
	} catch (_err) {
		return {
			ok: false,
			error: {
				code: "RUNNER_UNREACHABLE",
				message: "Nie udalo sie polaczyc z runnerem",
				status: 502,
			},
		};
	}

	if (!response.ok) {
		return {
			ok: false,
			error: {
				code: "RUNNER_REJECTED",
				message: `Runner odrzucil zadanie (${response.status})`,
				status: 502,
			},
		};
	}

	const parsed = JobCreatedResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		return {
			ok: false,
			error: {
				code: "RUNNER_INVALID_RESPONSE",
				message: "Runner zwrocil nieprawidlowa odpowiedz",
				status: 502,
			},
		};
	}

	const job = await createMigrationJob({
		deploymentId,
		type: "ingest",
		account: employee.email,
		dryRun: false,
		runnerJobId: parsed.data.jobId,
		triggeredByUserId,
	});

	return { ok: true, data: job };
}

function diffServerConfigFields(prev: ServerConfig | null, next: ServerConfig): string[] {
	const changed: string[] = [];
	for (const field of SERVER_CONFIG_TRACKED_FIELDS) {
		if ((prev?.[field] ?? undefined) !== (next[field] ?? undefined)) {
			changed.push(field);
		}
	}
	return changed;
}
