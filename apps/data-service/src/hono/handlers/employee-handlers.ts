import { zValidator } from "@hono/zod-validator";
import {
	EmployeeBulkCreateRequestSchema,
	EmployeeDeploymentParamSchema,
	EmployeeIdParamSchema,
	EmployeeSingleCreateRequestSchema,
	EmployeeUpdateRequestSchema,
} from "@repo/data-ops/employee";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import * as employeeService from "../services/employee-service";
import { resultToResponse } from "../utils/result-to-response";

const employeeHandlers = new Hono<{ Bindings: Env }>();

// List employees for a deployment (called through the frontend server functions)
employeeHandlers.get(
	"/deployment/:deploymentId",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", EmployeeDeploymentParamSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		return resultToResponse(c, await employeeService.getEmployeesByDeployment(deploymentId));
	},
);

// Bulk create employees (called from onboarding wizard step 4)
employeeHandlers.post(
	"/bulk",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("json", EmployeeBulkCreateRequestSchema),
	async (c) => {
		const data = c.req.valid("json");
		return resultToResponse(
			c,
			await employeeService.bulkCreateEmployees(data.deploymentId, data.employees, c.env),
			201,
		);
	},
);

// Create single employee (post-onboarding additions from admin UI)
employeeHandlers.post(
	"/",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("json", EmployeeSingleCreateRequestSchema),
	async (c) => {
		const { deploymentId, email, name } = c.req.valid("json");
		return resultToResponse(
			c,
			await employeeService.createSingleEmployee(deploymentId, { email, name }),
			201,
		);
	},
);

// Update employee (email/name) -- always allowed
employeeHandlers.patch(
	"/:employeeId",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", EmployeeIdParamSchema),
	zValidator("json", EmployeeUpdateRequestSchema),
	async (c) => {
		const { employeeId } = c.req.valid("param");
		const updates = c.req.valid("json");
		return resultToResponse(c, await employeeService.updateEmployee(employeeId, updates));
	},
);

export default employeeHandlers;
