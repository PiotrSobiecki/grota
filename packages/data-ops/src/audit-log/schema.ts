import { z } from "zod/v4";

export const ServerConfigAuditEntrySchema = z.object({
	id: z.string().uuid(),
	deploymentId: z.string().uuid(),
	userId: z.string(),
	changedFields: z.array(z.string()),
	changedAt: z.coerce.date(),
});

export type ServerConfigAuditEntry = z.infer<typeof ServerConfigAuditEntrySchema>;
