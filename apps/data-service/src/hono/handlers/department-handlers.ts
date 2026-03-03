import { zValidator } from "@hono/zod-validator";
import {
	DepartmentBulkCreateRequestSchema,
	DepartmentCreateRequestSchema,
	DepartmentDeploymentParamSchema,
	DepartmentIdParamSchema,
} from "@repo/data-ops/department";
import { Hono } from "hono";
import * as departmentService from "../services/department-service";
import { resultToResponse } from "../utils/result-to-response";

const departmentHandlers = new Hono<{ Bindings: Env }>();

// List departments for a deployment
departmentHandlers.get(
	"/:deploymentId",
	zValidator("param", DepartmentDeploymentParamSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		return resultToResponse(c, await departmentService.getDepartmentsByDeployment(deploymentId));
	},
);

// Create a single department
departmentHandlers.post(
	"/:deploymentId",
	zValidator("param", DepartmentDeploymentParamSchema),
	zValidator("json", DepartmentCreateRequestSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		const data = c.req.valid("json");
		return resultToResponse(
			c,
			await departmentService.createDeploymentDepartment(deploymentId, data),
			201,
		);
	},
);

// Bulk create departments
departmentHandlers.post(
	"/:deploymentId/bulk",
	zValidator("param", DepartmentDeploymentParamSchema),
	zValidator("json", DepartmentBulkCreateRequestSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		const { departments } = c.req.valid("json");
		return resultToResponse(
			c,
			await departmentService.createDeploymentDepartmentsBulk(deploymentId, departments),
			201,
		);
	},
);

// Delete a department
departmentHandlers.delete("/:id", zValidator("param", DepartmentIdParamSchema), async (c) => {
	const { id } = c.req.valid("param");
	return resultToResponse(c, await departmentService.deleteDeploymentDepartment(id));
});

export default departmentHandlers;
