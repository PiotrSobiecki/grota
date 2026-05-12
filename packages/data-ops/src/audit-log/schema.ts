import { z } from "zod/v4";

export const ServerConfigAuditEntrySchema = z.object({
	id: z.string().uuid(),
	deploymentId: z.string().uuid(),
	userId: z.string(),
	changedFields: z.array(z.string()),
	changedAt: z.coerce.date(),
});

export type ServerConfigAuditEntry = z.infer<typeof ServerConfigAuditEntrySchema>;

export const ScheduleAuditActionSchema = z.enum([
	"schedule.enabled",
	"schedule.disabled",
	"schedule.updated",
]);

export type ScheduleAuditAction = z.infer<typeof ScheduleAuditActionSchema>;

export const ScheduleAuditEntrySchema = z.object({
	id: z.string().uuid(),
	deploymentId: z.string().uuid(),
	userId: z.string(),
	action: ScheduleAuditActionSchema,
	diff: z.record(z.string(), z.unknown()),
	changedAt: z.coerce.date(),
});

export type ScheduleAuditEntry = z.infer<typeof ScheduleAuditEntrySchema>;
