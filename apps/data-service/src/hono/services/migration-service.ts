import {
	getDeployment,
	getDeploymentServerConfig,
	type ServerConfig,
	setDeploymentServerConfig,
} from "@repo/data-ops/deployment";
import {
	decryptServerConfig,
	encryptServerConfig,
	maskSecret,
} from "@repo/data-ops/encryption";
import {
	createMigrationJob,
	JobCreatedResponseSchema,
	type MigrationJob,
} from "@repo/data-ops/migration";
import type { Result } from "../types/result";

const NOT_FOUND = {
	ok: false as const,
	error: {
		code: "NOT_FOUND",
		message: "Wdrozenie nie zostalo znalezione",
		status: 404,
	},
};

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

export async function triggerBackup(
	input: TriggerBackupInput,
): Promise<Result<MigrationJob>> {
	const deployment = await getDeployment(input.deploymentId);
	if (!deployment) return NOT_FOUND;

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

	const requestBody: { account?: string } = {};
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

export async function setServerConfigFromAdmin(
	deploymentId: string,
	partial: Partial<ServerConfig>,
	encryptionKey: string,
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
		...(partial.ssh_host !== undefined ? { ssh_host: partial.ssh_host } : existing?.ssh_host ? { ssh_host: existing.ssh_host } : {}),
		...(partial.ssh_user !== undefined ? { ssh_user: partial.ssh_user } : existing?.ssh_user ? { ssh_user: existing.ssh_user } : {}),
		...(partial.runner_url !== undefined ? { runner_url: partial.runner_url } : existing?.runner_url ? { runner_url: existing.runner_url } : {}),
		...(partial.runner_token !== undefined ? { runner_token: partial.runner_token } : existing?.runner_token ? { runner_token: existing.runner_token } : {}),
	};

	const encrypted = await encryptServerConfig(merged, encryptionKey);
	await setDeploymentServerConfig(deploymentId, encrypted);
	return { ok: true, data: undefined };
}
