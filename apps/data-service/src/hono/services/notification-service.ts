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
		"✅ <b>Grota: Eksport konfiguracji zakonczony</b>",
		"",
		`<b>Klient:</b> ${clientName}`,
		`<b>Status:</b> active`,
		`<b>Deployment:</b> <code>${deploymentId}</code>`,
		`<b>Plik:</b> <code>configs/${deploymentId}/config.json</code>`,
	].join("\n");

	const response = await fetch(
		`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: env.TELEGRAM_CHAT_ID,
				text: message,
				parse_mode: "HTML",
			}),
		},
	);
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Telegram API error: ${response.status} ${body}`);
	}
}

export async function sendEmailSummary(
	to: string,
	name: string,
	clientName: string,
	employeeCount: number,
	folderCount: number,
	env: Env,
): Promise<void> {
	const subject = `Grota: Onboarding ${clientName} zakonczony`;
	const html = `
		<!doctype html>
		<html lang="pl">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>${subject}</title>
			</head>
		<body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif;color:#1e293b;">
			<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
				<tr>
					<td style="padding:24px 24px 12px 24px;">
						<p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.08em;color:#16a34a;text-transform:uppercase;">Grota</p>
						<h1 style="margin:0;font-size:22px;line-height:1.3;color:#0f172a;">Onboarding zakonczony</h1>
					</td>
				</tr>
				<tr>
					<td style="padding:8px 24px 0 24px;">
						<p style="margin:0 0 12px 0;font-size:16px;line-height:1.6;color:#1e293b;">Czesc ${name},</p>
						<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#475569;">
							Onboarding dla klienta <strong>${clientName}</strong> zostal zakonczony.
						</p>
					</td>
				</tr>
				<tr>
					<td style="padding:0 24px 8px 24px;">
						<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:8px;">
							<tr>
								<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#475569;">Liczba pracownikow</td>
								<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:700;color:#16a34a;text-align:right;">${employeeCount}</td>
							</tr>
							<tr>
								<td style="padding:12px 14px;font-size:14px;color:#475569;">Liczba folderow do backupu</td>
								<td style="padding:12px 14px;font-size:14px;font-weight:700;color:#16a34a;text-align:right;">${folderCount}</td>
							</tr>
						</table>
					</td>
				</tr>
				<tr>
					<td style="padding:8px 24px 20px 24px;">
						<p style="margin:0;font-size:14px;line-height:1.6;color:#64748b;">
							Operator rozpocznie konfiguracje backupu wkrotce.
						</p>
					</td>
				</tr>
				<tr>
					<td style="padding:16px 24px 24px 24px;border-top:1px solid #e2e8f0;">
						<p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
							To automatyczna wiadomosc systemu Grota.
						</p>
					</td>
				</tr>
			</table>
		</body>
		</html>
	`;

	const text = [
		`Czesc ${name},`,
		"",
		`Onboarding dla klienta ${clientName} zostal zakonczony.`,
		`Liczba pracownikow: ${employeeCount}`,
		`Liczba folderow do backupu: ${folderCount}`,
		"",
		"Operator rozpocznie konfiguracje backupu wkrotce.",
		"",
		"To automatyczna wiadomosc systemu Grota.",
	].join("\n");

	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.RESEND_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: "Grota <noreply@sobiecki.org>",
			to: [to],
			subject,
			html,
			text,
		}),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Resend API error: ${response.status} ${body}`);
	}
}
