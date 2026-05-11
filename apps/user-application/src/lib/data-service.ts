import { env } from "cloudflare:workers";

export function fetchDataService(path: string, init?: RequestInit): Promise<Response> {
	const headers = new Headers(init?.headers);
	if (!headers.has("Authorization")) {
		headers.set("Authorization", `Bearer ${env.VITE_API_TOKEN}`);
	}
	return env.DATA_SERVICE.fetch(
		new Request(`https://data-service${path}`, {
			...init,
			headers,
		}),
	);
}
