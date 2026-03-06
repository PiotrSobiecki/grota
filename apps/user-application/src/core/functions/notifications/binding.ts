import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { fetchDataService } from "@/lib/data-service";

interface NotificationResult {
	telegram: boolean;
	email: boolean;
}

export const sendNotifications = createServerFn({ method: "POST" })
	.inputValidator(z.object({ deploymentId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/notifications/${data.deploymentId}/send`, {
			method: "POST",
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Wysylanie powiadomien nie powiodlo sie",
				body.code ?? "NOTIFICATION_FAILED",
				response.status,
			);
		}

		return (await response.json()) as NotificationResult;
	});
