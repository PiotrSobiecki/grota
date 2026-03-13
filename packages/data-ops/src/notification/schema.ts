import { z } from "zod";

export const NotifyLevelSchema = z.enum(["info", "warn", "error"]);

export const CliNotifyRequestSchema = z.object({
	level: NotifyLevelSchema,
	message: z.string().min(1).max(2000),
	deployment_id: z.string().min(1),
	hostname: z.string().min(1),
	timestamp: z.string().datetime(),
});

export type NotifyLevel = z.infer<typeof NotifyLevelSchema>;
export type CliNotifyRequest = z.infer<typeof CliNotifyRequestSchema>;
