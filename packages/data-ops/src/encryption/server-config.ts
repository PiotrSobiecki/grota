import type { ServerConfig } from "@/deployment/schema";
import { decrypt, encrypt } from "./index";

export async function encryptServerConfig(
	config: ServerConfig,
	key: string,
): Promise<ServerConfig> {
	if (!config.runner_token) return config;
	const encrypted = await encrypt(config.runner_token, key);
	return { ...config, runner_token: encrypted };
}

export async function decryptServerConfig(
	config: ServerConfig,
	key: string,
): Promise<ServerConfig> {
	if (!config.runner_token) return config;
	const decrypted = await decrypt(config.runner_token, key);
	return { ...config, runner_token: decrypted };
}
