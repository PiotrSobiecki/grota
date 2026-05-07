import { zValidator } from "@hono/zod-validator";
import {
	EmployeeBulkCreateRequestSchema,
	EmployeeDeploymentParamSchema,
	EmployeeIdParamSchema,
	EmployeeSingleCreateRequestSchema,
	EmployeeUpdateRequestSchema,
} from "@repo/data-ops/employee";
import { Hono } from "hono";
import * as employeeService from "../services/employee-service";
import { resultToResponse } from "../utils/result-to-response";

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

// Create single employee (post-onboarding additions from admin UI)
employeeHandlers.post("/", zValidator("json", EmployeeSingleCreateRequestSchema), async (c) => {
	const { deploymentId, email, name } = c.req.valid("json");
	return resultToResponse(
		c,
		await employeeService.createSingleEmployee(deploymentId, { email, name }),
		201,
	);
});

// Update employee (email/name) -- always allowed
employeeHandlers.patch(
	"/:employeeId",
	zValidator("param", EmployeeIdParamSchema),
	zValidator("json", EmployeeUpdateRequestSchema),
	async (c) => {
		const { employeeId } = c.req.valid("param");
		const updates = c.req.valid("json");
		return resultToResponse(c, await employeeService.updateEmployee(employeeId, updates));
	},
);

export default employeeHandlers;
