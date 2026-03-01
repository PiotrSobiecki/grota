import { zValidator } from "@hono/zod-validator";
import {
	EmployeeBulkCreateRequestSchema,
	EmployeeDeploymentParamSchema,
} from "@repo/data-ops/employee";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as employeeService from "../services/employee-service";
import type { Result } from "../types/result";

function resultToResponse<T>(
	c: Context,
	result: Result<T>,
	successStatus: ContentfulStatusCode = 200,
) {
	if (!result.ok)
		return c.json(
			{ error: result.error.message, code: result.error.code },
			result.error.status as ContentfulStatusCode,
		);
	return c.json(result.data, successStatus);
}

const employeeHandlers = new Hono<{ Bindings: Env }>();

// List employees for a deployment (public -- token-gated in the frontend)
employeeHandlers.get(
	"/deployment/:deploymentId",
	zValidator("param", EmployeeDeploymentParamSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		return resultToResponse(c, await employeeService.getEmployeesByDeployment(deploymentId));
	},
);

// Bulk create employees (called from onboarding wizard step 4)
employeeHandlers.post("/bulk", zValidator("json", EmployeeBulkCreateRequestSchema), async (c) => {
	const data = c.req.valid("json");
	return resultToResponse(
		c,
		await employeeService.bulkCreateEmployees(data.deploymentId, data.employees, c.env),
		201,
	);
});

export default employeeHandlers;
