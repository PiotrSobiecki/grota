import { env } from "cloudflare:workers";
import { type ServerConfig, ServerConfigUpdateRequestSchema } from "@repo/data-ops/deployment";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { protectedFunctionMiddleware } from "@/core/middleware/auth";
import { fetchDataService } from "@/lib/data-service";

export type { ServerConfig };

export interface RunnerVerifyResult {
	ok: boolean;
	error?: string;
}

const DeploymentIdInput = z.object({ deploymentId: z.string().uuid() });

export const getServerConfig = createServerFn({ method: "GET" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(DeploymentIdInput)
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/deployments/${data.deploymentId}/server-config`, {
			headers: { Authorization: `Bearer ${env.VITE_API_TOKEN}` },
		});
		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie pobrac konfiguracji",
				body.code ?? "SERVER_CONFIG_GET_FAILED",
				response.status,
			);
		}
		return (await response.json()) as ServerConfig | null;
	});

export const updateServerConfig = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(
		z.object({
			deploymentId: z.string().uuid(),
			updates: ServerConfigUpdateRequestSchema,
		}),
	)
	.handler(async ({ data, context }) => {
		const response = await fetchDataService(`/deployments/${data.deploymentId}/server-config`, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${env.VITE_API_TOKEN}`,
				"content-type": "application/json",
				"X-Operator-Id": context.userId,
			},
			body: JSON.stringify(data.updates),
		});
		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Zapis konfiguracji nie powiodl sie",
				body.code ?? "SERVER_CONFIG_UPDATE_FAILED",
				response.status,
			);
		}
		return { success: true };
	});

export const testRunnerConnection = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(DeploymentIdInput)
	.handler(async ({ data }) => {
		const response = await fetchDataService(
			`/deployments/${data.deploymentId}/server-config/test`,
			{
				method: "POST",
				headers: { Authorization: `Bearer ${env.VITE_API_TOKEN}` },
			},
		);
		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Test polaczenia nie powiodl sie",
				body.code ?? "RUNNER_TEST_FAILED",
				response.status,
			);
		}
		return (await response.json()) as RunnerVerifyResult;
	});
