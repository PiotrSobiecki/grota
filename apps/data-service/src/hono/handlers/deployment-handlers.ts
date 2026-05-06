import { zValidator } from "@hono/zod-validator";
import {
	DeploymentCreateRequestSchema,
	DeploymentIdParamSchema,
	DeploymentListRequestSchema,
	DeploymentUpdateRequestSchema,
	ServerConfigUpdateRequestSchema,
} from "@repo/data-ops/deployment";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import * as deploymentService from "../services/deployment-service";
import * as migrationService from "../services/migration-service";
import { resultToResponse } from "../utils/result-to-response";

const deploymentHandlers = new Hono<{ Bindings: Env }>();

// List deployments for the authenticated operator
deploymentHandlers.get(
	"/",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("query", DeploymentListRequestSchema),
	async (c) => {
		const query = c.req.valid("query");
		// In MVP, operator ID comes from API_TOKEN header.
		// Future: extract from Better Auth session via service binding.
		const operatorId = c.req.header("X-Operator-Id") ?? "";
		return resultToResponse(c, await deploymentService.getDeployments(query, operatorId));
	},
);

// Create deployment
deploymentHandlers.post(
	"/",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("json", DeploymentCreateRequestSchema),
	async (c) => {
		const data = c.req.valid("json");
		const operatorId = c.req.header("X-Operator-Id") ?? "";
		return resultToResponse(c, await deploymentService.createDeployment(data, operatorId), 201);
	},
);

// Get deployment by ID
deploymentHandlers.get(
	"/:id",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", DeploymentIdParamSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		return resultToResponse(c, await deploymentService.getDeploymentById(id));
	},
);

// Update deployment
deploymentHandlers.put(
	"/:id",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", DeploymentIdParamSchema),
	zValidator("json", DeploymentUpdateRequestSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		const data = c.req.valid("json");
		return resultToResponse(c, await deploymentService.updateDeployment(id, data));
	},
);

// Get server config (decrypted runner_token, then masked)
deploymentHandlers.get(
	"/:id/server-config",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", DeploymentIdParamSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		return resultToResponse(
			c,
			await migrationService.getServerConfigForAdmin(id, c.env.ENCRYPTION_KEY),
		);
	},
);

// Test runner connection (calls runner POST /verify with B2 credentials)
deploymentHandlers.post(
	"/:id/server-config/test",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", DeploymentIdParamSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		return resultToResponse(
			c,
			await migrationService.testRunnerConnection(id, c.env.ENCRYPTION_KEY),
		);
	},
);

// Update server config (partial — only provided fields are merged; runner_token encrypted before persist)
deploymentHandlers.put(
	"/:id/server-config",
	(c, next) => authMiddleware(c.env.API_TOKEN)(c, next),
	zValidator("param", DeploymentIdParamSchema),
	zValidator("json", ServerConfigUpdateRequestSchema),
	async (c) => {
		const { id } = c.req.valid("param");
		const partial = c.req.valid("json");
		return resultToResponse(
			c,
			await migrationService.setServerConfigFromAdmin(id, partial, c.env.ENCRYPTION_KEY),
		);
	},
);

export default deploymentHandlers;
