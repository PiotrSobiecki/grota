import { setWorkspaceOAuthToken } from "@repo/data-ops/deployment";
import { setDriveOAuthToken } from "@repo/data-ops/employee";
import { encrypt } from "@repo/data-ops/encryption";
import type { Result } from "../types/result";

const ADMIN_SCOPES = [
	"https://www.googleapis.com/auth/admin.directory.group",
	"https://www.googleapis.com/auth/drive",
].join(" ");

const EMPLOYEE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

interface OAuthState {
	type: "admin" | "employee";
	id: string;
	token?: string;
}

interface GoogleTokenResponse {
	access_token: string;
	refresh_token?: string;
	scope: string;
	token_type: string;
	expires_in: number;
}

export function buildAuthorizationUrl(
	type: string,
	id: string,
	env: Env,
	redirectUri: string,
	token?: string,
): string {
	const statePayload: OAuthState = { type: type as OAuthState["type"], id, token };
	const state = btoa(JSON.stringify(statePayload));
	const scope = type === "admin" ? ADMIN_SCOPES : EMPLOYEE_SCOPES;

	const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", scope);
	url.searchParams.set("state", state);
	url.searchParams.set("access_type", "offline");
	url.searchParams.set("prompt", "consent");
	return url.toString();
}

export async function handleCallback(
	code: string,
	stateParam: string,
	env: Env,
	redirectUri: string,
): Promise<Result<{ redirectTo: string }>> {
	let state: OAuthState;
	try {
		state = JSON.parse(atob(stateParam)) as OAuthState;
	} catch {
		return {
			ok: false,
			error: { code: "INVALID_STATE", message: "Invalid OAuth state", status: 400 },
		};
	}

	const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: env.GOOGLE_CLIENT_ID,
			client_secret: env.GOOGLE_CLIENT_SECRET,
			redirect_uri: redirectUri,
			grant_type: "authorization_code",
		}),
	});

	if (!tokenResponse.ok) {
		const errorBody = await tokenResponse.text();
		console.error("Token exchange failed:", errorBody);
		return {
			ok: false,
			error: {
				code: "TOKEN_EXCHANGE_FAILED",
				message: "Nie udalo sie uzyskac tokenu Google",
				status: 502,
			},
		};
	}

	const tokens = (await tokenResponse.json()) as GoogleTokenResponse;

	const tokenPayload = JSON.stringify({
		access_token: tokens.access_token,
		refresh_token: tokens.refresh_token ?? null,
		scope: tokens.scope,
		token_type: tokens.token_type,
		expiry_date: Date.now() + tokens.expires_in * 1000,
	});

	const encryptedToken = await encrypt(tokenPayload, env.ENCRYPTION_KEY);

	const frontendOrigin = env.ALLOWED_ORIGINS.split(",")[0] ?? "";

	if (state.type === "admin") {
		await setWorkspaceOAuthToken(state.id, encryptedToken);
		const redirectPath = state.token ? `/onboard/${state.token}` : `/onboard/${state.id}`;
		return {
			ok: true,
			data: { redirectTo: `${frontendOrigin}${redirectPath}?oauth=success` },
		};
	}

	await setDriveOAuthToken(state.id, encryptedToken);
	const redirectPath = state.token ? `/employee/${state.token}` : `/employee/${state.id}`;
	return {
		ok: true,
		data: { redirectTo: `${frontendOrigin}${redirectPath}?oauth=success` },
	};
}
