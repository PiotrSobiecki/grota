import { z } from "zod";

export const INTERVAL_PRESETS = [1, 6, 12, 24, 168] as const;
export const IntervalHoursSchema = z.union([
	z.literal(1),
	z.literal(6),
	z.literal(12),
	z.literal(24),
	z.literal(168),
]);

export const AnchorTimeSchema = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "anchorTime musi mieć format HH:MM");

export const DeploymentScheduleSchema = z.object({
	deploymentId: z.string().uuid(),
	enabled: z.boolean(),
	intervalHours: z.number().int().positive(),
	anchorTime: z.string(),
	anchorTimezone: z.string(),
	lastRunAt: z.coerce.date().nullable(),
	nextRunAt: z.coerce.date().nullable(),
	lastJobId: z.string().uuid().nullable(),
	lastStatus: z.string().nullable(),
	retryAttemptsRemaining: z.number().int().nonnegative(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});

export const SetScheduleRequestSchema = z.object({
	enabled: z.boolean(),
	intervalHours: IntervalHoursSchema,
	anchorTime: AnchorTimeSchema,
});

export type DeploymentSchedule = z.infer<typeof DeploymentScheduleSchema>;
export type SetScheduleInput = z.infer<typeof SetScheduleRequestSchema>;
