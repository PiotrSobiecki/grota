import { zValidator } from "@hono/zod-validator";
import {
	SharedDriveBulkUpsertRequestSchema,
	SharedDriveCreateRequestSchema,
	SharedDriveDeploymentParamSchema,
} from "@repo/data-ops/shared-drive";
import { Hono } from "hono";
import * as sharedDriveService from "../services/shared-drive-service";
import { resultToResponse } from "../utils/result-to-response";

const sharedDriveHandlers = new Hono<{ Bindings: Env }>();

sharedDriveHandlers.get(
	"/:deploymentId",
	zValidator("param", SharedDriveDeploymentParamSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		return resultToResponse(c, await sharedDriveService.listSharedDrives(deploymentId));
	},
);

sharedDriveHandlers.put(
	"/:deploymentId",
	zValidator("param", SharedDriveDeploymentParamSchema),
	zValidator("json", SharedDriveBulkUpsertRequestSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		const { drives } = c.req.valid("json");
		return resultToResponse(c, await sharedDriveService.saveSharedDrives(deploymentId, drives));
	},
);

sharedDriveHandlers.post(
	"/:deploymentId/create",
	zValidator("param", SharedDriveDeploymentParamSchema),
	zValidator("json", SharedDriveCreateRequestSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		const { drives } = c.req.valid("json");
		return resultToResponse(
			c,
			await sharedDriveService.createAndSaveSharedDrives(deploymentId, drives, c.env),
		);
	},
);

sharedDriveHandlers.delete(
	"/:deploymentId",
	zValidator("param", SharedDriveDeploymentParamSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		return resultToResponse(c, await sharedDriveService.removeSharedDrives(deploymentId));
	},
);

export default sharedDriveHandlers;
