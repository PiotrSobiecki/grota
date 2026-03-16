import { type ConfigJson, getConfigAssemblyData } from "@repo/data-ops/config";
import { getDeployment, updateDeployment, updateDeploymentStatus } from "@repo/data-ops/deployment";
import { decrypt } from "@repo/data-ops/encryption";
import type { Result } from "../types/result";
import { sendEmailSummary, sendTelegramNotification } from "./notification-service";

interface TokenPayload {
	refresh_token: string | null;
}

export async function buildConfigJson(
	deploymentId: string,
	encryptionKey: string,
): Promise<Result<ConfigJson>> {
	const data = await getConfigAssemblyData(deploymentId);
	if (!data) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie znalezione", status: 404 },
		};
	}

	let workspaceRefreshToken: string | null = null;
	if (data.deployment.workspaceOauthToken) {
		try {
			const decrypted = await decrypt(data.deployment.workspaceOauthToken, encryptionKey);
			const parsed = JSON.parse(decrypted) as TokenPayload;
			workspaceRefreshToken = parsed.refresh_token;
		} catch (err) {
			// biome-ignore lint/suspicious/noConsole: Worker logs for decrypt diagnostics
			console.error("Failed to decrypt workspace token:", err);
		}
	}

	const accounts = await Promise.all(
		data.accounts.map(async (account) => {
			let refreshToken: string | null = null;
			if (account.driveOauthToken) {
				try {
					const decrypted = await decrypt(account.driveOauthToken, encryptionKey);
					const parsed = JSON.parse(decrypted) as TokenPayload;
					refreshToken = parsed.refresh_token;
				} catch (err) {
					// biome-ignore lint/suspicious/noConsole: Worker logs for decrypt diagnostics
					console.error(`Failed to decrypt token for ${account.email}:`, err);
				}
			}

			return {
				email: account.email,
				name: account.name,
				oauth_refresh_token: refreshToken,
				folders: account.folders.map((f) => ({
					id: f.folderId,
					name: f.folderName,
					shared_drive_name: f.shared_drive_name,
				})),
			};
		}),
	);

	const config: ConfigJson = {
		deployment_id: data.deployment.id,
		client_name: data.deployment.clientName,
		domain: data.deployment.domain,
		created_at: data.deployment.createdAt.toISOString(),
		workspace: workspaceRefreshToken
			? {
					oauth_refresh_token: workspaceRefreshToken,
					shared_drives: data.sharedDrives.map((sd) => ({
						name: sd.name,
						id: sd.googleDriveId,
					})),
				}
			: null,
		accounts,
		b2: data.deployment.b2Config ?? null,
		server: data.deployment.serverConfig ?? null,
	};

	return { ok: true, data: config };
}

export async function previewConfig(deploymentId: string, env: Env): Promise<Result<ConfigJson>> {
	return buildConfigJson(deploymentId, env.ENCRYPTION_KEY);
}

interface ExportResult {
	r2Key: string;
	status: string;
}

export async function exportConfig(deploymentId: string, env: Env): Promise<Result<ExportResult>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie znalezione", status: 404 },
		};
	}

	if (deployment.status !== "ready" && deployment.status !== "active") {
		return {
			ok: false,
			error: {
				code: "INVALID_STATUS",
				message: `Eksport mozliwy tylko ze statusu 'ready' lub 'active'. Obecny status: ${deployment.status}`,
				status: 400,
			},
		};
	}

	const configResult = await buildConfigJson(deploymentId, env.ENCRYPTION_KEY);
	if (!configResult.ok) return configResult;

	const r2Key = `configs/${deploymentId}/config.json`;
	const configJson = JSON.stringify(configResult.data, null, 2);

	await env.CONFIG_BUCKET.put(r2Key, configJson, {
		httpMetadata: { contentType: "application/json" },
	});

	await updateDeployment(deploymentId, { r2ConfigKey: r2Key });

	if (deployment.status === "ready") {
		await updateDeploymentStatus(deploymentId, "active");
	}

	sendTelegramNotification(deployment.clientName, deploymentId, env).catch((err) =>
		// biome-ignore lint/suspicious/noConsole: Worker logs for notification diagnostics
		console.error("Telegram notification failed:", err),
	);

	if (deployment.adminEmail) {
		sendEmailSummary(
			deployment.adminEmail,
			deployment.adminName ?? "Administrator",
			deployment.clientName,
			configResult.data.accounts.length,
			configResult.data.accounts.reduce(
				(sum, a) => sum + a.folders.filter((f) => f.shared_drive_name !== null).length,
				0,
			),
			env,
		).catch((err) =>
			// biome-ignore lint/suspicious/noConsole: Worker logs for notification diagnostics
			console.error("Email summary failed:", err),
		);
	}

	return { ok: true, data: { r2Key, status: "active" } };
}
