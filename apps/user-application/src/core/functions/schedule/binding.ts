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
	anchorTime: string;
	anchorTimezone: string;
	lastRunAt: string | null;
	nextRunAt: string | null;
	lastJobId: string | null;
	lastStatus: string | null;
	createdAt: string;
	updatedAt: string;
}

const DeploymentIdInput = z.object({ deploymentId: z.string().uuid() });

const IntervalHoursClient = z.union([
	z.literal(1),
	z.literal(6),
	z.literal(12),
	z.literal(24),
	z.literal(168),
]);

const SetScheduleInput = z.object({
	deploymentId: z.string().uuid(),
	enabled: z.boolean(),
	intervalHours: IntervalHoursClient,
	anchorTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
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

export const setSchedule = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(SetScheduleInput)
	.handler(async ({ data, context }) => {
		const response = await fetchDataService(`/admin/deployments/${data.deploymentId}/schedule`, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${env.VITE_API_TOKEN}`,
				"content-type": "application/json",
				"X-Operator-Id": context.userId,
			},
			body: JSON.stringify({
				enabled: data.enabled,
				intervalHours: data.intervalHours,
				anchorTime: data.anchorTime,
			}),
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
