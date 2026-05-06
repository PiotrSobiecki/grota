import { zValidator } from "@hono/zod-validator";
import { TriggerBackupRequestSchema } from "@repo/data-ops/migration";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import * as migrationService from "../services/migration-service";
import { resultToResponse } from "../utils/result-to-response";

const migrationHandlers = new Hono<{ Bindings: Env }>();

migrationHandlers.post(
	"/backup",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("json", TriggerBackupRequestSchema),
	async (c) => {
		const body = c.req.valid("json");
		const operatorId = c.req.header("X-Operator-Id") ?? "";
		return resultToResponse(
			c,
			await migrationService.triggerBackup({
				deploymentId: body.deploymentId,
				account: body.account,
				triggeredByUserId: operatorId,
				encryptionKey: c.env.ENCRYPTION_KEY,
			}),
			202,
		);
	},
);

export default migrationHandlers;
