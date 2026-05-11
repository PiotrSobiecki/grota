import { Hono } from "hono";
import * as oauthService from "../services/oauth-service";

const oauthHandlers = new Hono<{ Bindings: Env }>();

function getFrontendOrigin(env: Env): string {
	const firstOrigin = env.ALLOWED_ORIGINS.split(",")[0]?.trim();
	return firstOrigin || "http://localhost:3000";
}

oauthHandlers.get("/google/authorize", async (c) => {
	const type = c.req.query("type");
	const id = c.req.query("id");

	if (!type || !id) {
		return c.json({ error: "Missing type or id parameter" }, 400);
	}

	const token = c.req.query("token");
	const origin = new URL(c.req.url).origin;
	const redirectUri = `${origin}/api/oauth/google/callback`;
	const url = oauthService.buildAuthorizationUrl(type, id, c.env, redirectUri, token);
	return c.redirect(url);
});

oauthHandlers.get("/google/callback", async (c) => {
	const code = c.req.query("code");
	const state = c.req.query("state");
	const error = c.req.query("error");

	if (error) {
		const frontendOrigin = getFrontendOrigin(c.env);
		return c.redirect(`${frontendOrigin}/?oauth_error=${error}`);
	}

	if (!code || !state) {
		return c.json({ error: "Missing code or state" }, 400);
	}

	const redirectUri = `${new URL(c.req.url).origin}/api/oauth/google/callback`;
	const result = await oauthService.handleCallback(code, state, c.env, redirectUri);

	if (!result.ok) {
		const frontendOrigin = getFrontendOrigin(c.env);
		return c.redirect(`${frontendOrigin}/?oauth_error=${result.error.code}`);
	}

	return c.redirect(result.data.redirectTo);
});

export default oauthHandlers;
