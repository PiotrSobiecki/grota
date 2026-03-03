import { type ConfigJson, getConfigAssemblyData } from "@repo/data-ops/config";
import { decrypt } from "@repo/data-ops/encryption";
import type { Result } from "../types/result";

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
					category: f.category,
				})),
			};
		}),
	);

	const config: ConfigJson = {
		deployment_id: data.deployment.id,
		client_name: data.deployment.clientName,
		domain: data.deployment.domain,
		created_at: data.deployment.createdAt.toISOString(),
		workspace: workspaceRefreshToken ? { oauth_refresh_token: workspaceRefreshToken } : null,
		accounts,
		b2: data.deployment.b2Config ?? null,
		server: data.deployment.serverConfig ?? null,
	};

	return { ok: true, data: config };
}

export async function previewConfig(deploymentId: string, env: Env): Promise<Result<ConfigJson>> {
	return buildConfigJson(deploymentId, env.ENCRYPTION_KEY);
}
