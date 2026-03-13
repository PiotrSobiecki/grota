import { zValidator } from "@hono/zod-validator";
import { CliNotifyRequestSchema } from "@repo/data-ops/notification";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { sendCliNotification } from "../services/cli-notify-service";
import { resultToResponse } from "../utils/result-to-response";

const cliNotifyHandlers = new Hono<{ Bindings: Env }>();

cliNotifyHandlers.post(
	"/",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("json", CliNotifyRequestSchema),
	async (c) => {
		const payload = c.req.valid("json");
		return resultToResponse(c, await sendCliNotification(payload, c.env));
	},
);

export default cliNotifyHandlers;
