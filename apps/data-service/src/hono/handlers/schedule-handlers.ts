import { zValidator } from "@hono/zod-validator";
import { DeploymentIdParamSchema } from "@repo/data-ops/deployment";
import { SetScheduleRequestSchema } from "@repo/data-ops/schedule";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import * as scheduleService from "../services/schedule-service";
import { resultToResponse } from "../utils/result-to-response";

const scheduleHandlers = new Hono<{ Bindings: Env }>();

scheduleHandlers.get(
	"/:id/schedule",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", DeploymentIdParamSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		return resultToResponse(c, await scheduleService.getScheduleForDeployment(id));
	},
);

scheduleHandlers.put(
	"/:id/schedule",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", DeploymentIdParamSchema),
	zValidator("json", SetScheduleRequestSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		const input = c.req.valid("json");
		const operatorId = c.req.header("X-Operator-Id") ?? null;
		return resultToResponse(
			c,
			await scheduleService.setScheduleForDeployment(id, input, operatorId),
		);
	},
);

export default scheduleHandlers;
