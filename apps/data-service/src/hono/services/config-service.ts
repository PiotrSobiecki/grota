import { type ConfigJson, getConfigAssemblyData } from "@repo/data-ops/config";
import { getDeployment, updateDeployment, updateDeploymentStatus } from "@repo/data-ops/deployment";
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
				(sum, a) => sum + a.folders.filter((f) => f.category !== "prywatne").length,
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

async function sendTelegramNotification(
	clientName: string,
	deploymentId: string,
	env: Env,
): Promise<void> {
	const message = [
		"Grota: Eksport konfiguracji zakonczony",
		`Klient: ${clientName}`,
		`Deployment: ${deploymentId}`,
		`Plik: configs/${deploymentId}/config.json`,
		"Status: active",
	].join("\n");

	await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: env.TELEGRAM_CHAT_ID,
			text: message,
			parse_mode: "HTML",
		}),
	});
}

async function sendEmailSummary(
	to: string,
	name: string,
	clientName: string,
	employeeCount: number,
	folderCount: number,
	env: Env,
): Promise<void> {
	const html = `
		<p>Czesc ${name},</p>
		<p>Onboarding dla <strong>${clientName}</strong> zostal zakonczony.</p>
		<ul>
			<li>Liczba pracownikow: ${employeeCount}</li>
			<li>Liczba folderow do backupu: ${folderCount}</li>
		</ul>
		<p>Operator rozpocznie konfiguracje backupu wkrotce.</p>
		<p>-- Grota</p>
	`;

	await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.RESEND_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: "Grota <noreply@grota.app>",
			to: [to],
			subject: `Grota: Onboarding ${clientName} zakonczony`,
			html,
		}),
	});
}
