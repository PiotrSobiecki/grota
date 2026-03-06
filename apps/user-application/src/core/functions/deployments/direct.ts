import {
	createDeployment,
	DeploymentCreateRequestSchema,
	DeploymentListRequestSchema,
	DeploymentUpdateRequestSchema,
	deleteDeployment,
	getDeployment,
	getDeployments,
	updateDeployment,
} from "@repo/data-ops/deployment";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { protectedFunctionMiddleware } from "@/core/middleware/auth";

export const listDeployments = createServerFn({ method: "GET" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(DeploymentListRequestSchema)
	.handler(async ({ data, context }) => {
		return getDeployments(data, context.userId);
	});

export const createNewDeployment = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(DeploymentCreateRequestSchema)
	.handler(async ({ data, context }) => {
		return createDeployment({ ...data, createdBy: context.userId });
	});

export const getDeploymentById = createServerFn({ method: "GET" })
	.inputValidator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data }) => {
		const deployment = await getDeployment(data.id);
		if (!deployment) {
			throw new AppError("Wdrozenie nie zostalo znalezione", "NOT_FOUND", 404);
		}
		return deployment;
	});

export const deleteDeploymentById = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data, context }) => {
		const deleted = await deleteDeployment(data.id, context.userId);
		if (!deleted) {
			throw new AppError("Wdrozenie nie zostalo znalezione", "NOT_FOUND", 404);
		}
		return { success: true };
	});

export const updateExistingDeployment = createServerFn({ method: "POST" })
	.inputValidator(
		z.object({
			id: z.string().uuid(),
			updates: DeploymentUpdateRequestSchema,
		}),
	)
	.handler(async ({ data }) => {
		const deployment = await updateDeployment(data.id, data.updates);
		if (!deployment) {
			throw new AppError("Wdrozenie nie zostalo znalezione", "NOT_FOUND", 404);
		}
		return deployment;
	});
