import { zValidator } from "@hono/zod-validator";
import { EmployeeIdParamSchema } from "@repo/data-ops/employee";
import { Hono } from "hono";
import * as folderService from "../services/folder-service";
import { resultToResponse } from "../utils/result-to-response";

const folderHandlers = new Hono<{ Bindings: Env }>();

folderHandlers.get("/drive/:employeeId", zValidator("param", EmployeeIdParamSchema), async (c) => {
	const { employeeId } = c.req.valid("param");
	return resultToResponse(c, await folderService.listDriveFolders(employeeId, c.env));
});

export default folderHandlers;
