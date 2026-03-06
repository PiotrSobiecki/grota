import { z } from "zod";

// ============================================
// Enums
// ============================================

export const OAuthStatusSchema = z.enum(["pending", "authorized", "failed"]);
export const SelectionStatusSchema = z.enum(["pending", "in_progress", "completed"]);

// ============================================
// Domain Model
// ============================================

export const EmployeeSchema = z.object({
	id: z.string().uuid(),
	deploymentId: z.string().uuid(),
	email: z.string().email(),
	name: z.string(),
	oauthStatus: OAuthStatusSchema,
	selectionStatus: SelectionStatusSchema,
	driveOauthToken: z.string().nullable(),
	magicLinkToken: z.string().nullable(),
	magicLinkExpiresAt: z.coerce.date().nullable(),
	magicLinkSentAt: z.coerce.date().nullable(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});

// ============================================
// Param Schemas
// ============================================

export const EmployeeDeploymentParamSchema = z.object({
	deploymentId: z.string().uuid("Nieprawidlowy format ID"),
});

export const EmployeeIdParamSchema = z.object({
	employeeId: z.string().uuid("Nieprawidlowy format ID"),
});

export const EmployeeTokenParamSchema = z.object({
	token: z.string().min(1, "Token jest wymagany"),
});

// ============================================
// Request Schemas
// ============================================

export const EmployeeCreateRequestSchema = z.object({
	email: z.string().email("Nieprawidlowy format email"),
	name: z.string().max(100, "Maksymalnie 100 znakow").optional().default(""),
	departmentIds: z.array(z.string().uuid()).min(1, "Przynajmniej jeden dzial wymagany"),
});

export const EmployeeBulkCreateRequestSchema = z.object({
	deploymentId: z.string().uuid(),
	employees: z
		.array(EmployeeCreateRequestSchema)
		.min(1, "Przynajmniej jeden pracownik jest wymagany"),
});

// ============================================
// Response Schemas
// ============================================

/** Public employee response -- excludes magic link token and OAuth tokens */
export const EmployeeResponseSchema = EmployeeSchema.omit({
	magicLinkToken: true,
	driveOauthToken: true,
});

export const EmployeeListResponseSchema = z.object({
	data: z.array(EmployeeResponseSchema),
	total: z.number(),
});

// ============================================
// Types
// ============================================

export type OAuthStatus = z.infer<typeof OAuthStatusSchema>;
export type SelectionStatus = z.infer<typeof SelectionStatusSchema>;
export type Employee = z.infer<typeof EmployeeSchema>;
export type EmployeeCreateInput = z.infer<typeof EmployeeCreateRequestSchema>;
export type EmployeeBulkCreateInput = z.infer<typeof EmployeeBulkCreateRequestSchema>;
export type EmployeeResponse = z.infer<typeof EmployeeResponseSchema>;
export type EmployeeListResponse = z.infer<typeof EmployeeListResponseSchema>;
