import { getDeployment, updateDeploymentStatus } from "@repo/data-ops/deployment";
import {
	getEmployeeById,
	getEmployeeByToken,
	getEmployeesByDeployment,
	updateEmployeeMagicLink,
} from "@repo/data-ops/employee";
import {
	canResendMagicLink,
	generateMagicLinkToken,
	getDeploymentByAdminToken,
	getMagicLinkExpiry,
	isMagicLinkValid,
	updateAdminMagicLink,
} from "@repo/data-ops/magic-link";
import { getSharedDrivesByDeployment } from "@repo/data-ops/shared-drive";
import type { Result } from "../types/result";

interface ResendSuccessResponse {
	id: string;
}

interface ResendErrorResponse {
	statusCode: number;
	message: string;
	name: string;
}

interface MagicLinkResult {
	token: string;
	url: string;
	emailSent: boolean;
	emailError?: string;
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
	const emailResult = await sendMagicLinkEmail(
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
			emailSent: emailResult.ok,
			emailError: emailResult.ok ? undefined : emailResult.error.message,
		},
	};
}

interface AdminTokenData {
	deploymentId: string;
	step: number;
	status: string;
	clientName: string;
	domain: string;
	adminEmail: string | null;
	adminName: string | null;
	operatorEmail: string;
}

export async function verifyAdminToken(token: string): Promise<Result<AdminTokenData>> {
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
			status: deployment.status,
			clientName: deployment.clientName,
			domain: deployment.domain,
			adminEmail: deployment.adminEmail,
			adminName: deployment.adminName,
			operatorEmail: deployment.operatorEmail,
		},
	};
}

/** Map Resend error name to a user-friendly Polish message. */
function getResendErrorMessage(error: ResendErrorResponse): string {
	switch (error.name) {
		case "missing_api_key":
		case "invalid_api_key":
		case "restricted_api_key":
			return "Blad konfiguracji serwera email. Skontaktuj sie z administratorem.";
		case "validation_error":
			return `Blad walidacji email: ${error.message}`;
		case "rate_limit_exceeded":
		case "daily_quota_exceeded":
		case "monthly_quota_exceeded":
			return "Przekroczono limit wysylki email. Sprobuj ponownie pozniej.";
		case "application_error":
		case "internal_server_error":
			return "Serwer email jest chwilowo niedostepny. Sprobuj ponownie pozniej.";
		default:
			return `Blad wysylki email: ${error.message}`;
	}
}

/** Send magic link email via Resend API. */
export async function sendMagicLinkEmail(
	to: string,
	name: string,
	token: string,
	type: "onboard" | "employee",
	env: Env,
): Promise<Result<{ emailId: string }>> {
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

	let response: Response;
	try {
		response = await fetch("https://api.resend.com/emails", {
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
	} catch (err) {
		const message = err instanceof Error ? err.message : "Nieznany blad sieci";
		// biome-ignore lint/suspicious/noConsole: Worker logs for email delivery diagnostics
		console.error("[sendMagicLinkEmail] Network error:", message);
		return {
			ok: false,
			error: {
				code: "EMAIL_NETWORK_ERROR",
				message: `Nie udalo sie polaczyc z serwisem email: ${message}`,
				status: 502,
			},
		};
	}

	if (!response.ok) {
		let resendError: ResendErrorResponse | undefined;
		try {
			resendError = (await response.json()) as ResendErrorResponse;
		} catch {
			// Response body is not valid JSON
		}

		const errorName = resendError?.name ?? "unknown";
		const errorMessage = resendError
			? getResendErrorMessage(resendError)
			: `Resend API zwrocil status ${response.status}`;

		// biome-ignore lint/suspicious/noConsole: Worker logs for email delivery diagnostics
		console.error("[sendMagicLinkEmail] Resend API error:", {
			status: response.status,
			name: errorName,
			message: resendError?.message,
			to,
		});

		return {
			ok: false,
			error: {
				code: `EMAIL_${errorName.toUpperCase()}`,
				message: errorMessage,
				status: response.status,
			},
		};
	}

	const data = (await response.json()) as ResendSuccessResponse;
	// biome-ignore lint/suspicious/noConsole: Worker logs for email delivery diagnostics
	console.info("[sendMagicLinkEmail] Email sent successfully:", { emailId: data.id, to });

	return {
		ok: true,
		data: { emailId: data.id },
	};
}

export async function generateEmployeeMagicLinks(
	deploymentId: string,
	env: Env,
): Promise<Result<{ sent: number }>> {
	const employeeList = await getEmployeesByDeployment(deploymentId);

	let sent = 0;
	const errors: string[] = [];
	for (const employee of employeeList) {
		const token = generateMagicLinkToken();
		const expiresAt = getMagicLinkExpiry(7);
		await updateEmployeeMagicLink(employee.id, token, expiresAt);
		const emailResult = await sendMagicLinkEmail(
			employee.email,
			employee.name,
			token,
			"employee",
			env,
		);
		if (emailResult.ok) {
			sent++;
		} else {
			errors.push(`${employee.email}: ${emailResult.error.message}`);
		}
	}

	if (sent === 0 && errors.length > 0) {
		return {
			ok: false,
			error: {
				code: "EMAIL_SEND_FAILED",
				message: errors[0] ?? "Nie udalo sie wyslac zadnego emaila",
				status: 502,
			},
		};
	}

	return { ok: true, data: { sent } };
}

export async function resendEmployeeMagicLink(
	employeeId: string,
	env: Env,
): Promise<Result<{ sent: boolean }>> {
	const employee = await getEmployeeById(employeeId);
	if (!employee) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Pracownik nie znaleziony", status: 404 },
		};
	}

	if (!canResendMagicLink(employee.magicLinkSentAt)) {
		return {
			ok: false,
			error: {
				code: "RATE_LIMITED",
				message: "Mozna wyslac ponownie za 5 minut",
				status: 429,
			},
		};
	}

	const token = generateMagicLinkToken();
	const expiresAt = getMagicLinkExpiry(7);
	await updateEmployeeMagicLink(employee.id, token, expiresAt);
	const emailResult = await sendMagicLinkEmail(
		employee.email,
		employee.name,
		token,
		"employee",
		env,
	);

	if (!emailResult.ok) {
		return {
			ok: false,
			error: emailResult.error,
		};
	}

	return { ok: true, data: { sent: true } };
}

export async function verifyEmployeeToken(token: string): Promise<
	Result<{
		employeeId: string;
		deploymentId: string;
		sharedDrives: Array<{ id: string; name: string }>;
	}>
> {
	const employee = await getEmployeeByToken(token);

	if (!employee) {
		return {
			ok: false,
			error: { code: "INVALID_TOKEN", message: "Nieprawidlowy lub wygasly link", status: 401 },
		};
	}

	if (!isMagicLinkValid(employee.magicLinkExpiresAt)) {
		return {
			ok: false,
			error: {
				code: "TOKEN_EXPIRED",
				message: "Link wygasl. Popros o ponowne wyslanie.",
				status: 401,
			},
		};
	}

	const drives = await getSharedDrivesByDeployment(employee.deploymentId);

	return {
		ok: true,
		data: {
			employeeId: employee.id,
			deploymentId: employee.deploymentId,
			sharedDrives: drives.map((d) => ({ id: d.id, name: d.name })),
		},
	};
}
