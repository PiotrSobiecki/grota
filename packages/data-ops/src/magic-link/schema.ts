import { z } from "zod";

export const MagicLinkDeploymentParamSchema = z.object({
	deploymentId: z.string().uuid("Nieprawidlowy format ID"),
});

export const MagicLinkTokenParamSchema = z.object({
	token: z.string().min(1, "Token jest wymagany"),
});
