export interface NotifyJobFailedInput {
	deploymentId: string;
	jobId: string | null;
	reason: "job_failed" | "retry_exhausted";
	clientName: string;
	exitCode: number | null;
	logTail: string | null;
}

export interface NotifyJobFailedResult {
	telegram: "ok" | "err";
	email: "ok" | "err";
}

const FALLBACK_RECIPIENT = "piotr@sobiecki.org";

export async function notifyJobFailed(
	input: NotifyJobFailedInput,
	env: Env,
): Promise<NotifyJobFailedResult> {
	const link = buildPanelLink(env, input.deploymentId);
	const recipient = pickRecipient(env);

	const [tgOutcome, mailOutcome] = await Promise.allSettled([
		sendTelegramAlert(input, link, env),
		sendEmailAlert(input, link, recipient, env),
	]);

	return {
		telegram: tgOutcome.status === "fulfilled" ? "ok" : "err",
		email: mailOutcome.status === "fulfilled" ? "ok" : "err",
	};
}

function pickRecipient(env: Env): string {
	const value = (env as unknown as Record<string, string | undefined>).OPERATOR_ALERT_EMAIL;
	return value && value.length > 0 ? value : FALLBACK_RECIPIENT;
}

function buildPanelLink(env: Env, deploymentId: string): string {
	const base = (env as unknown as Record<string, string | undefined>).PUBLIC_APP_URL;
	const origin = base && base.length > 0 ? base.replace(/\/$/, "") : "https://grota.sobiecki.org";
	return `${origin}/dashboard/${deploymentId}/migration`;
}

function formatExitCode(code: number | null): string {
	return code === null ? "n/a" : String(code);
}

function formatReason(reason: NotifyJobFailedInput["reason"]): string {
	return reason === "retry_exhausted" ? "retry exhausted" : "job failed";
}

async function sendTelegramAlert(
	input: NotifyJobFailedInput,
	link: string,
	env: Env,
): Promise<void> {
	const lines = [
		"🚨 <b>Grota: alert harmonogramu</b>",
		"",
		`<b>Klient:</b> ${input.clientName}`,
		`<b>Przyczyna:</b> ${formatReason(input.reason)}`,
		`<b>Deployment:</b> <code>${input.deploymentId}</code>`,
		`<b>Job ID:</b> <code>${input.jobId ?? "n/a"}</code>`,
		`<b>Exit code:</b> ${formatExitCode(input.exitCode)}`,
		`<b>Panel:</b> ${link}`,
	];
	const response = await fetch(
		`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: env.TELEGRAM_CHAT_ID,
				text: lines.join("\n"),
				parse_mode: "HTML",
				disable_web_page_preview: true,
			}),
		},
	);
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Telegram API error: ${response.status} ${body}`);
	}
}

async function sendEmailAlert(
	input: NotifyJobFailedInput,
	link: string,
	to: string,
	env: Env,
): Promise<void> {
	const subject = `Grota: alert harmonogramu (${input.clientName})`;
	const reason = formatReason(input.reason);
	const exitCode = formatExitCode(input.exitCode);
	const jobIdDisplay = input.jobId ?? "n/a";
	const logBlock = input.logTail ? `\n\nOstatnie linie logu:\n${input.logTail}\n` : "";

	const text = [
		`Klient: ${input.clientName}`,
		`Przyczyna: ${reason}`,
		`Deployment: ${input.deploymentId}`,
		`Job ID: ${jobIdDisplay}`,
		`Exit code: ${exitCode}`,
		`Panel: ${link}`,
		logBlock,
	].join("\n");

	const html = [
		'<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111">',
		`<h2 style="margin:0 0 12px">Grota: alert harmonogramu</h2>`,
		`<p><strong>Klient:</strong> ${escapeHtml(input.clientName)}</p>`,
		`<p><strong>Przyczyna:</strong> ${escapeHtml(reason)}</p>`,
		`<p><strong>Deployment:</strong> <code>${escapeHtml(input.deploymentId)}</code></p>`,
		`<p><strong>Job ID:</strong> <code>${escapeHtml(jobIdDisplay)}</code></p>`,
		`<p><strong>Exit code:</strong> ${escapeHtml(exitCode)}</p>`,
		`<p><a href="${link}">Otwórz panel migracji</a></p>`,
		input.logTail
			? `<p><strong>Ostatnie linie logu:</strong></p><pre style="background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap">${escapeHtml(input.logTail)}</pre>`
			: "",
		"</body></html>",
	].join("");

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

export interface NotifyJobSucceededInput {
	deploymentId: string;
	jobId: string;
	clientName: string;
	durationSeconds: number | null;
}

export async function notifyJobSucceeded(
	input: NotifyJobSucceededInput,
	env: Env,
): Promise<{ telegram: "ok" | "err" }> {
	const link = buildPanelLink(env, input.deploymentId);
	const lines = [
		"✅ <b>Grota: cykl ukończony pomyślnie</b>",
		"",
		`<b>Klient:</b> ${input.clientName}`,
		`<b>Deployment:</b> <code>${input.deploymentId}</code>`,
		`<b>Job ID:</b> <code>${input.jobId}</code>`,
		`<b>Czas trwania:</b> ${input.durationSeconds === null ? "n/a" : `${input.durationSeconds}s`}`,
		`<b>Panel:</b> ${link}`,
	];
	try {
		const response = await fetch(
			`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: env.TELEGRAM_CHAT_ID,
					text: lines.join("\n"),
					parse_mode: "HTML",
					disable_web_page_preview: true,
				}),
			},
		);
		if (!response.ok) return { telegram: "err" };
		return { telegram: "ok" };
	} catch {
		return { telegram: "err" };
	}
}

export function isSuccessNotificationEnabled(env: Env): boolean {
	const raw = (env as unknown as Record<string, string | undefined>).OPERATOR_NOTIFY_SUCCESS;
	if (raw === undefined) return true;
	const normalized = raw.trim().toLowerCase();
	return normalized !== "false" && normalized !== "0" && normalized !== "";
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
