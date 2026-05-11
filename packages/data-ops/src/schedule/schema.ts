import { z } from "zod";

export const DeploymentScheduleSchema = z.object({
	deploymentId: z.string().uuid(),
	enabled: z.boolean(),
	intervalHours: z.number().int().positive(),
	lastRunAt: z.coerce.date().nullable(),
	nextRunAt: z.coerce.date().nullable(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});

export const SetScheduleEnabledRequestSchema = z.object({
	enabled: z.boolean(),
});

export type DeploymentSchedule = z.infer<typeof DeploymentScheduleSchema>;
export type SetScheduleEnabledInput = z.infer<typeof SetScheduleEnabledRequestSchema>;
