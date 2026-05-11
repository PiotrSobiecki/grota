import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { protectedFunctionMiddleware } from "@/core/middleware/auth";
import { fetchDataService } from "@/lib/data-service";

export interface DeploymentScheduleDto {
	deploymentId: string;
	enabled: boolean;
	intervalHours: number;
	lastRunAt: string | null;
	nextRunAt: string | null;
	createdAt: string;
	updatedAt: string;
}

const DeploymentIdInput = z.object({ deploymentId: z.string().uuid() });
const SetScheduleEnabledInput = z.object({
	deploymentId: z.string().uuid(),
	enabled: z.boolean(),
});

export const getDeploymentSchedule = createServerFn({ method: "GET" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(DeploymentIdInput)
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/admin/deployments/${data.deploymentId}/schedule`, {
			headers: { Authorization: `Bearer ${env.VITE_API_TOKEN}` },
		});
		if (!response.ok) {
			const errBody = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				errBody.error ?? "Nie udalo sie pobrac harmonogramu",
				errBody.code ?? "SCHEDULE_GET_FAILED",
				response.status,
			);
		}
		return (await response.json()) as DeploymentScheduleDto | null;
	});

export const setScheduleEnabled = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(SetScheduleEnabledInput)
	.handler(async ({ data, context }) => {
		const response = await fetchDataService(`/admin/deployments/${data.deploymentId}/schedule`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.VITE_API_TOKEN}`,
				"content-type": "application/json",
				"X-Operator-Id": context.userId,
			},
			body: JSON.stringify({ enabled: data.enabled }),
		});
		if (!response.ok) {
			const errBody = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				errBody.error ?? "Nie udalo sie zapisac harmonogramu",
				errBody.code ?? "SCHEDULE_SET_FAILED",
				response.status,
			);
		}
		return (await response.json()) as DeploymentScheduleDto;
	});
