import { serve } from "@hono/node-server";
import { createApp } from "./app";

const VERSION = "0.1.0";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value || value.length === 0) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
	return value;
}

const token = requireEnv("GROTA_TOKEN");
const port = Number(process.env.GROTA_PORT ?? "7878");

const app = createApp({ token, version: VERSION });

serve({ fetch: app.fetch, port }, (info) => {
	console.log(`grota-runner v${VERSION} listening on :${info.port}`);
});
