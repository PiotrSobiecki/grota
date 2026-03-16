import { getConfigAssemblyData } from "@repo/data-ops/config";
import { getDeployment } from "@repo/data-ops/deployment";
import type { Result } from "../types/result";

interface NotificationResult {
	telegram: boolean;
	email: boolean;
}

export async function sendDeploymentNotifications(
	deploymentId: string,
	env: Env,
): Promise<Result<NotificationResult>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie znalezione", status: 404 },
		};
	}

	if (deployment.status !== "active") {
		return {
			ok: false,
			error: {
				code: "INVALID_STATUS",
				message: "Powiadomienia mozliwe tylko dla statusu 'active'",
				status: 400,
			},
		};
	}

	const configData = await getConfigAssemblyData(deploymentId);
	const accountCount = configData?.accounts.length ?? 0;
	const folderCount =
		configData?.accounts.reduce(
			(sum, a) => sum + a.folders.filter((f) => f.shared_drive_name !== null).length,
			0,
		) ?? 0;

	let telegramOk = false;
	let emailOk = false;

	try {
		await sendTelegramNotification(deployment.clientName, deploymentId, env);
		telegramOk = true;
	} catch (err) {
		// biome-ignore lint/suspicious/noConsole: Worker logs for notification diagnostics
		console.error("Telegram notification failed:", err);
	}

	if (deployment.adminEmail) {
		try {
			await sendEmailSummary(
				deployment.adminEmail,
				deployment.adminName ?? "Administrator",
				deployment.clientName,
				accountCount,
				folderCount,
				env,
			);
			emailOk = true;
		} catch (err) {
			// biome-ignore lint/suspicious/noConsole: Worker logs for notification diagnostics
			console.error("Email notification failed:", err);
		}
	}

	return { ok: true, data: { telegram: telegramOk, email: emailOk } };
}

export async function sendTelegramNotification(
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

export async function sendEmailSummary(
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
