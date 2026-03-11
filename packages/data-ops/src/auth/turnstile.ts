interface TurnstileResponse {
	success: boolean;
	"error-codes"?: string[];
}

type TurnstileResult = { ok: true; data: true } | { ok: false; error: string };

export async function verifyTurnstile(token: string, secretKey: string): Promise<TurnstileResult> {
	const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ secret: secretKey, response: token }),
	});

	if (!response.ok) {
		return { ok: false, error: "Turnstile verification request failed" };
	}

	const result = (await response.json()) as TurnstileResponse;
	if (!result.success) {
		const codes = result["error-codes"]?.join(", ") ?? "unknown";
		return { ok: false, error: `Turnstile verification failed: ${codes}` };
	}

	return { ok: true, data: true };
}
