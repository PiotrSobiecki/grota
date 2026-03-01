import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { protectedFunctionMiddleware } from "@/core/middleware/auth";
import { fetchDataService } from "@/lib/data-service";

export const generateAdminMagicLink = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(z.object({ deploymentId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/magic-links/admin/${data.deploymentId}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.VITE_API_TOKEN}`,
			},
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie wygenerowac linku",
				body.code ?? "MAGIC_LINK_ERROR",
				response.status,
			);
		}

		return (await response.json()) as { token: string; url: string };
	});

export const verifyAdminToken = createServerFn({ method: "GET" })
	.inputValidator(z.object({ token: z.string().min(1) }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/magic-links/verify/admin/${data.token}`);

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nieprawidlowy lub wygasly link",
				body.code ?? "TOKEN_ERROR",
				response.status,
			);
		}

		return (await response.json()) as { deploymentId: string; step: number };
	});
