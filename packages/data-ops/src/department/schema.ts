import { z } from "zod";

export const MAX_DEPARTMENTS_PER_DEPLOYMENT = 10;

export const DEPARTMENT_SUGGESTIONS = [
	{ name: "Zarzad", slug: "zarzad" },
	{ name: "Ksiegowosc", slug: "ksiegowosc" },
	{ name: "Projekty", slug: "projekty" },
	{ name: "Media", slug: "media" },
	{ name: "Marketing", slug: "marketing" },
	{ name: "Sprzedaz", slug: "sprzedaz" },
	{ name: "IT", slug: "it" },
	{ name: "Finanse", slug: "finanse" },
	{ name: "Prawo", slug: "prawo" },
	{ name: "Operacje", slug: "operacje" },
] as const;

// ============================================
// Domain Model
// ============================================

export const DepartmentSchema = z.object({
	id: z.string().uuid(),
	deploymentId: z.string().uuid(),
	name: z.string().min(1).max(100),
	slug: z.string().min(1).max(50),
	sortOrder: z.number().int().min(0),
	createdAt: z.coerce.date(),
});

// ============================================
// Param Schemas
// ============================================

export const DepartmentDeploymentParamSchema = z.object({
	deploymentId: z.string().uuid("Nieprawidlowy format ID"),
});

export const DepartmentIdParamSchema = z.object({
	id: z.string().uuid("Nieprawidlowy format ID"),
});

// ============================================
// Request Schemas
// ============================================

export const DepartmentCreateRequestSchema = z.object({
	name: z.string().min(1, "Nazwa dzialu jest wymagana").max(100),
});

export const DepartmentUpdateRequestSchema = z.object({
	name: z.string().min(1, "Nazwa dzialu jest wymagana").max(100),
});

export const DepartmentBulkCreateRequestSchema = z.object({
	departments: z
		.array(
			z.object({
				name: z.string().min(1, "Nazwa dzialu jest wymagana").max(100),
			}),
		)
		.min(1, "Przynajmniej jeden dzial jest wymagany"),
});

// ============================================
// Response Schemas
// ============================================

export const DepartmentListResponseSchema = z.object({
	data: z.array(DepartmentSchema),
	total: z.number(),
});

// ============================================
// Types
// ============================================

export type Department = z.infer<typeof DepartmentSchema>;
export type DepartmentCreateInput = z.infer<typeof DepartmentCreateRequestSchema>;
export type DepartmentUpdateInput = z.infer<typeof DepartmentUpdateRequestSchema>;
export type DepartmentListResponse = z.infer<typeof DepartmentListResponseSchema>;
