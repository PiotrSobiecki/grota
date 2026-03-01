import { getDeployment, updateDeploymentStatus } from "@repo/data-ops/deployment";
import {
	generateMagicLinkToken,
	getDeploymentByAdminToken,
	getMagicLinkExpiry,
	isMagicLinkValid,
	updateAdminMagicLink,
} from "@repo/data-ops/magic-link";
import type { Result } from "../types/result";

interface MagicLinkResult {
	token: string;
	url: string;
}

export async function generateAdminMagicLink(
	deploymentId: string,
	env: Env,
): Promise<Result<MagicLinkResult>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie znalezione", status: 404 },
		};
	}

	if (!deployment.adminEmail) {
		return {
			ok: false,
			error: {
				code: "VALIDATION_ERROR",
				message: "Email administratora klienta jest wymagany",
				status: 400,
				field: "adminEmail",
			},
		};
	}

	const token = generateMagicLinkToken();
	const expiresAt = getMagicLinkExpiry(7);

	await updateAdminMagicLink(deploymentId, token, expiresAt);

	// Transition status to onboarding
	if (deployment.status === "draft") {
		await updateDeploymentStatus(deploymentId, "onboarding");
	}

	// Send email via Resend
	await sendMagicLinkEmail(
		deployment.adminEmail,
		deployment.adminName ?? "Administrator",
		token,
		"onboard",
		env,
	);

	return {
		ok: true,
		data: {
			token,
			url: `/onboard/${token}`,
		},
	};
}

export async function verifyAdminToken(
	token: string,
): Promise<Result<{ deploymentId: string; step: number }>> {
	const deployment = await getDeploymentByAdminToken(token);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "INVALID_TOKEN", message: "Nieprawidlowy lub wygasly link", status: 401 },
		};
	}

	if (!isMagicLinkValid(deployment.adminMagicLinkExpiresAt)) {
		return {
			ok: false,
			error: {
				code: "TOKEN_EXPIRED",
				message: "Link wygasl. Popros operatora o nowy.",
				status: 401,
			},
		};
	}

	return {
		ok: true,
		data: {
			deploymentId: deployment.id,
			step: deployment.onboardingStep ?? 0,
		},
	};
}

/** Send magic link email via Resend API. */
export async function sendMagicLinkEmail(
	to: string,
	name: string,
	token: string,
	type: "onboard" | "employee",
	env: Env,
): Promise<void> {
	const baseUrl = env.ALLOWED_ORIGINS?.split(",")[0] ?? "http://localhost:3000";
	const path = type === "onboard" ? `/onboard/${token}` : `/employee/${token}`;
	const url = `${baseUrl}${path}`;

	const subject =
		type === "onboard" ? "Grota: Rozpocznij onboarding" : "Grota: Autoryzuj dostep do Google Drive";

	const html = `
    <p>Czesc ${name},</p>
    <p>${
			type === "onboard"
				? "Zostales zaproszony do konfiguracji onboardingu w Grota."
				: "Zostales zaproszony do autoryzacji dostepu do Google Drive w Grota."
		}</p>
    <p><a href="${url}">Kliknij tutaj aby rozpoczac</a></p>
    <p>Link wazny przez 7 dni.</p>
    <p>-- Grota</p>
  `;

	await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.RESEND_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: "Grota <noreply@auditmos.com>",
			to: [to],
			subject,
			html,
		}),
	});
}
