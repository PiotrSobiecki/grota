import { z } from "zod";

// ============================================
// Enums
// ============================================

export const DeploymentStatusSchema = z.enum([
	"draft",
	"onboarding",
	"employees_pending",
	"ready",
	"active",
]);

// ============================================
// JSONB sub-schemas (resolves B5, B6)
// ============================================

export const B2ConfigSchema = z.object({
	key_id: z.string().min(1, "B2 Key ID is required"),
	app_key: z.string().min(1, "B2 App Key is required"),
	bucket_prefix: z.string().min(1, "Bucket prefix is required"),
});

export const ServerConfigSchema = z.object({
	backup_path: z.string().min(1, "Backup path is required"),
	bwlimit: z.string().min(1, "Bandwidth limit is required"),
	ssh_host: z.string().optional(),
	ssh_user: z.string().optional(),
});

// ============================================
// Domain Model
// ============================================

export const DeploymentSchema = z.object({
	id: z.string().uuid(),
	clientName: z.string(),
	domain: z.string(),
	status: DeploymentStatusSchema,
	onboardingStep: z.number(),
	adminEmail: z.string().email().nullable(),
	adminName: z.string().nullable(),
	adminMagicLinkToken: z.string().nullable(),
	adminMagicLinkExpiresAt: z.coerce.date().nullable(),
	workspaceOauthToken: z.string().nullable(),
	b2Config: B2ConfigSchema.nullable(),
	serverConfig: ServerConfigSchema.nullable(),
	r2ConfigKey: z.string().nullable(),
	createdBy: z.string(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});

// ============================================
// Request Schemas
// ============================================

export const DeploymentCreateRequestSchema = z.object({
	clientName: z
		.string()
		.min(1, "Nazwa klienta jest wymagana")
		.max(100, "Nazwa klienta moze miec maksymalnie 100 znakow"),
	domain: z
		.string()
		.min(1, "Domena jest wymagana")
		.max(253, "Domena moze miec maksymalnie 253 znaki"),
	adminEmail: z.string().email("Nieprawidlowy format email").optional(),
	adminName: z.string().min(1).max(100).optional(),
});

export const DeploymentUpdateRequestSchema = z
	.object({
		clientName: z.string().min(1).max(100).optional(),
		domain: z.string().min(1).max(253).optional(),
		adminEmail: z.string().email().optional(),
		adminName: z.string().min(1).max(100).optional(),
		b2Config: B2ConfigSchema.optional(),
		serverConfig: ServerConfigSchema.optional(),
	})
	.refine(
		(data) =>
			data.clientName ||
			data.domain ||
			data.adminEmail ||
			data.adminName ||
			data.b2Config ||
			data.serverConfig,
		{ message: "Przynajmniej jedno pole jest wymagane" },
	);

export const DeploymentIdParamSchema = z.object({
	id: z.string().uuid("Nieprawidlowy format ID"),
});

export const DeploymentListRequestSchema = z.object({
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0),
	status: DeploymentStatusSchema.optional(),
});

// ============================================
// Response Schemas
// ============================================

/** Public deployment response -- excludes magic link tokens and encrypted OAuth tokens */
export const DeploymentResponseSchema = DeploymentSchema.omit({
	adminMagicLinkToken: true,
	adminMagicLinkExpiresAt: true,
	workspaceOauthToken: true,
});

export const DeploymentListResponseSchema = z.object({
	data: z.array(DeploymentResponseSchema),
	pagination: z.object({
		total: z.number(),
		limit: z.number(),
		offset: z.number(),
		hasMore: z.boolean(),
	}),
});

// ============================================
// Types
// ============================================

export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;
export type B2Config = z.infer<typeof B2ConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;
export type DeploymentCreateInput = z.infer<typeof DeploymentCreateRequestSchema>;
export type DeploymentUpdateInput = z.infer<typeof DeploymentUpdateRequestSchema>;
export type DeploymentResponse = z.infer<typeof DeploymentResponseSchema>;
export type DeploymentListResponse = z.infer<typeof DeploymentListResponseSchema>;
export type DeploymentListRequest = z.infer<typeof DeploymentListRequestSchema>;
