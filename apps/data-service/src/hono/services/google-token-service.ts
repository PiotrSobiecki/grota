import { getWorkspaceOAuthToken, setWorkspaceOAuthToken } from "@repo/data-ops/deployment";
import { decrypt, encrypt } from "@repo/data-ops/encryption";
import type { Result } from "../types/result";

interface TokenPayload {
	access_token: string;
	refresh_token: string | null;
	expiry_date: number;
}

export async function refreshAccessToken(
	refreshToken: string,
	env: Env,
): Promise<Result<{ access_token: string; expiry_date: number }>> {
	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.GOOGLE_CLIENT_ID,
			client_secret: env.GOOGLE_CLIENT_SECRET,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}),
	});

	if (!response.ok) {
		return {
			ok: false,
			error: {
				code: "TOKEN_REFRESH_FAILED",
				message: "Nie udalo sie odswiezyc tokenu Google. Prosimy o ponowna autoryzacje.",
				status: 401,
			},
		};
	}

	const data = (await response.json()) as {
		access_token: string;
		expires_in: number;
	};

	return {
		ok: true,
		data: {
			access_token: data.access_token,
			expiry_date: Date.now() + data.expires_in * 1000,
		},
	};
}

export async function getValidWorkspaceAccessToken(
	deploymentId: string,
	env: Env,
): Promise<Result<string>> {
	const encryptedToken = await getWorkspaceOAuthToken(deploymentId);
	if (!encryptedToken) {
		return {
			ok: false,
			error: {
				code: "NO_WORKSPACE_TOKEN",
				message: "Brak autoryzacji Workspace. Przejdz przez krok 2 onboardingu.",
				status: 401,
			},
		};
	}

	let tokenPayload: TokenPayload;
	try {
		const decrypted = await decrypt(encryptedToken, env.ENCRYPTION_KEY);
		tokenPayload = JSON.parse(decrypted);
	} catch {
		return {
			ok: false,
			error: {
				code: "TOKEN_DECRYPT_FAILED",
				message: "Nie udalo sie odszyfrowac tokenu. Prosimy o ponowna autoryzacje.",
				status: 500,
			},
		};
	}

	let accessToken = tokenPayload.access_token;
	if (Date.now() > tokenPayload.expiry_date && tokenPayload.refresh_token) {
		const refreshResult = await refreshAccessToken(tokenPayload.refresh_token, env);
		if (!refreshResult.ok) return refreshResult;

		accessToken = refreshResult.data.access_token;
		const updatedPayload: TokenPayload = {
			...tokenPayload,
			access_token: accessToken,
			expiry_date: refreshResult.data.expiry_date,
		};
		const encrypted = await encrypt(JSON.stringify(updatedPayload), env.ENCRYPTION_KEY);
		await setWorkspaceOAuthToken(deploymentId, encrypted);
	}

	return { ok: true, data: accessToken };
}
