import {
	createDeployment,
	DeploymentCreateRequestSchema,
	DeploymentListRequestSchema,
	getDeployments,
} from "@repo/data-ops/deployment";
import { createServerFn } from "@tanstack/react-start";
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
