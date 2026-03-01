import { zValidator } from "@hono/zod-validator";
import {
	EmployeeDeploymentParamSchema,
	EmployeeIdParamSchema,
	EmployeeTokenParamSchema,
} from "@repo/data-ops/employee";
import {
	MagicLinkDeploymentParamSchema,
	MagicLinkTokenParamSchema,
} from "@repo/data-ops/magic-link";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authMiddleware } from "../middleware/auth";
import * as magicLinkService from "../services/magic-link-service";
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

const magicLinkHandlers = new Hono<{ Bindings: Env }>();

// Generate admin magic link for a deployment (operator action)
magicLinkHandlers.post(
	"/admin/:deploymentId",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", MagicLinkDeploymentParamSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		return resultToResponse(c, await magicLinkService.generateAdminMagicLink(deploymentId, c.env));
	},
);

// Verify admin token (public -- no auth required)
magicLinkHandlers.get(
	"/verify/admin/:token",
	zValidator("param", MagicLinkTokenParamSchema),
	async (c) => {
		const { token } = c.req.valid("param");
		return resultToResponse(c, await magicLinkService.verifyAdminToken(token));
	},
);

// Generate/resend employee magic links for a deployment (operator or system action)
magicLinkHandlers.post(
	"/employees/:deploymentId",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", EmployeeDeploymentParamSchema),
	async (c) => {
		const { deploymentId } = c.req.valid("param");
		return resultToResponse(
			c,
			await magicLinkService.generateEmployeeMagicLinks(deploymentId, c.env),
		);
	},
);

// Resend a single employee magic link (public -- rate-limited)
magicLinkHandlers.post(
	"/resend/:employeeId",
	zValidator("param", EmployeeIdParamSchema),
	async (c) => {
		const { employeeId } = c.req.valid("param");
		return resultToResponse(c, await magicLinkService.resendEmployeeMagicLink(employeeId, c.env));
	},
);

// Verify employee token (public -- no auth required)
magicLinkHandlers.get(
	"/verify/employee/:token",
	zValidator("param", EmployeeTokenParamSchema),
	async (c) => {
		const { token } = c.req.valid("param");
		return resultToResponse(c, await magicLinkService.verifyEmployeeToken(token));
	},
);

export default magicLinkHandlers;
