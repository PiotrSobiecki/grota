import type { CliNotifyRequest } from "@repo/data-ops/notification";
import type { Result } from "../types/result";

const LEVEL_ICONS: Record<string, string> = {
	info: "\u2139\ufe0f",
	warn: "\u26a0\ufe0f",
	error: "\u274c",
};

export async function sendCliNotification(
	payload: CliNotifyRequest,
	env: Env,
): Promise<Result<{ sent: boolean }>> {
	const icon = LEVEL_ICONS[payload.level] ?? "";
	const lines = [
		`${icon} <b>Grota CLI [${payload.level.toUpperCase()}]</b>`,
		"",
		payload.message,
		"",
		`<b>Deployment:</b> ${payload.deployment_id}`,
		`<b>Host:</b> ${payload.hostname}`,
		`<b>Time:</b> ${payload.timestamp}`,
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
			}),
		},
	);

	if (!response.ok) {
		const body = await response.text();
		return {
			ok: false,
			error: {
				code: "TELEGRAM_FAILED",
				message: `Telegram API error: ${response.status} ${body}`,
				status: 502,
			},
		};
	}

	return { ok: true, data: { sent: true } };
}
