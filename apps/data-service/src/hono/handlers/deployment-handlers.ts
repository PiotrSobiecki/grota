import { zValidator } from "@hono/zod-validator";
import {
	DeploymentCreateRequestSchema,
	DeploymentIdParamSchema,
	DeploymentListRequestSchema,
	DeploymentUpdateRequestSchema,
} from "@repo/data-ops/deployment";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authMiddleware } from "../middleware/auth";
import * as deploymentService from "../services/deployment-service";
import type { Result } from "../types/result";

function resultToResponse<T>(
	c: Context,
	result: Result<T>,
	successStatus: ContentfulStatusCode = 200,
) {
	if (!result.ok)
		return c.json(
			{ error: result.error.message, code: result.error.code },
			result.error.status as ContentfulStatusCode,
		);
	return c.json(result.data, successStatus);
}

const deploymentHandlers = new Hono<{ Bindings: Env }>();

// List deployments for the authenticated operator
deploymentHandlers.get(
	"/",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("query", DeploymentListRequestSchema),
	async (c) => {
		const query = c.req.valid("query");
		// In MVP, operator ID comes from API_TOKEN header.
		// Future: extract from Better Auth session via service binding.
		const operatorId = c.req.header("X-Operator-Id") ?? "";
		return resultToResponse(c, await deploymentService.getDeployments(query, operatorId));
	},
);

// Create deployment
deploymentHandlers.post(
	"/",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("json", DeploymentCreateRequestSchema),
	async (c) => {
		const data = c.req.valid("json");
		const operatorId = c.req.header("X-Operator-Id") ?? "";
		return resultToResponse(c, await deploymentService.createDeployment(data, operatorId), 201);
	},
);

// Get deployment by ID
deploymentHandlers.get(
	"/:id",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", DeploymentIdParamSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		return resultToResponse(c, await deploymentService.getDeploymentById(id));
	},
);

// Update deployment
deploymentHandlers.put(
	"/:id",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", DeploymentIdParamSchema),
	zValidator("json", DeploymentUpdateRequestSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		const data = c.req.valid("json");
		return resultToResponse(c, await deploymentService.updateDeployment(id, data));
	},
);

export default deploymentHandlers;
