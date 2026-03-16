import { zValidator } from "@hono/zod-validator";
import { EmployeeIdParamSchema } from "@repo/data-ops/employee";
import {
	DriveItemListQuerySchema,
	FolderSelectionBulkCreateRequestSchema,
} from "@repo/data-ops/folder-selection";
import { Hono } from "hono";
import * as folderService from "../services/folder-service";
import { resultToResponse } from "../utils/result-to-response";

const folderHandlers = new Hono<{ Bindings: Env }>();

folderHandlers.get(
	"/drive/:employeeId",
	zValidator("param", EmployeeIdParamSchema),
	zValidator("query", DriveItemListQuerySchema),
	async (c) => {
		const { employeeId } = c.req.valid("param");
		const { parentId, pageToken } = c.req.valid("query");
		return resultToResponse(
			c,
			await folderService.listDriveItems(employeeId, parentId, pageToken, c.env),
		);
	},
);

folderHandlers.get(
	"/selections/:employeeId",
	zValidator("param", EmployeeIdParamSchema),
	async (c) => {
		const { employeeId } = c.req.valid("param");
		return resultToResponse(c, await folderService.getSelections(employeeId));
	},
);

folderHandlers.post(
	"/selections",
	zValidator("json", FolderSelectionBulkCreateRequestSchema),
	async (c) => {
		const data = c.req.valid("json");
		return resultToResponse(
			c,
			await folderService.saveSelections(data.employeeId, data.selections, c.env),
			201,
		);
	},
);

export default folderHandlers;
