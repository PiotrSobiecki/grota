import { zValidator } from "@hono/zod-validator";
import {
	MigrationJobIdParamSchema,
	MigrationJobListRequestSchema,
	TriggerBackupRequestSchema,
	TriggerGDriveRestoreRequestSchema,
	TriggerIngestRequestSchema,
	TriggerMigrateRequestSchema,
} from "@repo/data-ops/migration";
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

migrationHandlers.post(
	"/migrate",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("json", TriggerMigrateRequestSchema),
	async (c) => {
		const body = c.req.valid("json");
		const operatorId = c.req.header("X-Operator-Id") ?? "";
		return resultToResponse(
			c,
			await migrationService.triggerMigrate({
				deploymentId: body.deploymentId,
				account: body.account,
				dryRun: body.dryRun,
				triggeredByUserId: operatorId,
				encryptionKey: c.env.ENCRYPTION_KEY,
			}),
			202,
		);
	},
);

migrationHandlers.post(
	"/gdrive-restore",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("json", TriggerGDriveRestoreRequestSchema),
	async (c) => {
		const body = c.req.valid("json");
		const operatorId = c.req.header("X-Operator-Id") ?? "";
		return resultToResponse(
			c,
			await migrationService.triggerGDriveRestore({
				deploymentId: body.deploymentId,
				account: body.account,
				triggeredByUserId: operatorId,
				env: c.env,
			}),
			202,
		);
	},
);

migrationHandlers.post(
	"/ingest",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("json", TriggerIngestRequestSchema),
	async (c) => {
		const body = c.req.valid("json");
		const operatorId = c.req.header("X-Operator-Id") ?? "";
		return resultToResponse(
			c,
			await migrationService.triggerIngest({
				deploymentId: body.deploymentId,
				employeeId: body.employeeId,
				triggeredByUserId: operatorId,
				env: c.env,
			}),
			202,
		);
	},
);

migrationHandlers.get(
	"/jobs",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("query", MigrationJobListRequestSchema),
	async (c) => {
		const query = c.req.valid("query");
		return resultToResponse(c, await migrationService.listMigrationJobsForAdmin(query));
	},
);

migrationHandlers.get(
	"/jobs/:id",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", MigrationJobIdParamSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		return resultToResponse(
			c,
			await migrationService.getMigrationJobStatus(id, c.env.ENCRYPTION_KEY),
		);
	},
);

migrationHandlers.get(
	"/jobs/:id/logs/stream",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", MigrationJobIdParamSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		const result = await migrationService.streamJobLogs(id, c.env.ENCRYPTION_KEY);
		if (!result.ok) {
			return c.json({ error: result.error }, result.error.status as 400 | 404 | 502);
		}
		return result.data;
	},
);

export default migrationHandlers;
