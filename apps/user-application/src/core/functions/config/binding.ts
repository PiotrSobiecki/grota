import { env } from "cloudflare:workers";
import type { ConfigJson } from "@repo/data-ops/config";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { protectedFunctionMiddleware } from "@/core/middleware/auth";
import { fetchDataService } from "@/lib/data-service";

export type { ConfigJson };

export interface ExportResult {
	r2Key: string;
	status: string;
}

export const getConfigPreview = createServerFn({ method: "GET" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(z.object({ deploymentId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/config/preview/${data.deploymentId}`, {
			headers: { Authorization: `Bearer ${env.VITE_API_TOKEN}` },
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udało się pobrać podglądu konfiguracji",
				body.code ?? "CONFIG_PREVIEW_FAILED",
				response.status,
			);
		}

		return (await response.json()) as ConfigJson;
	});

export const exportConfig = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(z.object({ deploymentId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/config/export/${data.deploymentId}`, {
			method: "POST",
			headers: { Authorization: `Bearer ${env.VITE_API_TOKEN}` },
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Eksport nie powiódł się",
				body.code ?? "CONFIG_EXPORT_FAILED",
				response.status,
			);
		}

		return (await response.json()) as ExportResult;
	});
