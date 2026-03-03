import { zValidator } from "@hono/zod-validator";
import { EmployeeDeploymentParamSchema } from "@repo/data-ops/employee";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import * as configService from "../services/config-service";
import { resultToResponse } from "../utils/result-to-response";

const configHandlers = new Hono<{ Bindings: Env }>();

configHandlers.get(
	"/preview/:deploymentId",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", EmployeeDeploymentParamSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		return resultToResponse(c, await configService.previewConfig(deploymentId, c.env));
	},
);

export default configHandlers;
