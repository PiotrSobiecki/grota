import { Hono } from "hono";
import * as oauthService from "../services/oauth-service";

const oauthHandlers = new Hono<{ Bindings: Env }>();

oauthHandlers.get("/google/authorize", async (c) => {
	const type = c.req.query("type");
	const id = c.req.query("id");

	if (!type || !id) {
		return c.json({ error: "Missing type or id parameter" }, 400);
	}

	const token = c.req.query("token");
	const redirectUri = `${c.req.url.split("/api")[0]}/api/oauth/google/callback`;
	const url = oauthService.buildAuthorizationUrl(type, id, c.env, redirectUri, token);
	return c.redirect(url);
});

oauthHandlers.get("/google/callback", async (c) => {
	const code = c.req.query("code");
	const state = c.req.query("state");
	const error = c.req.query("error");

	if (error) {
		const frontendOrigin = c.env.ALLOWED_ORIGINS.split(",")[0] ?? "";
		return c.redirect(`${frontendOrigin}/?oauth_error=${error}`);
	}

	if (!code || !state) {
		return c.json({ error: "Missing code or state" }, 400);
	}

	const redirectUri = `${c.req.url.split("?")[0]}`;
	const result = await oauthService.handleCallback(code, state, c.env, redirectUri);

	if (!result.ok) {
		const frontendOrigin = c.env.ALLOWED_ORIGINS.split(",")[0] ?? "";
		return c.redirect(`${frontendOrigin}/?oauth_error=${result.error.code}`);
	}

	return c.redirect(result.data.redirectTo);
});

export default oauthHandlers;
