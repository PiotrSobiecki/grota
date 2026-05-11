import { zValidator } from "@hono/zod-validator";
import { DeploymentIdParamSchema } from "@repo/data-ops/deployment";
import { SetScheduleEnabledRequestSchema } from "@repo/data-ops/schedule";
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

scheduleHandlers.post(
	"/:id/schedule",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", DeploymentIdParamSchema),
	zValidator("json", SetScheduleEnabledRequestSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		const { enabled } = c.req.valid("json");
		return resultToResponse(c, await scheduleService.setScheduleEnabledForDeployment(id, enabled));
	},
);

export default scheduleHandlers;
