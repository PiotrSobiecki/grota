import { z } from "zod";

export const SharedDriveCategorySchema = z.enum(["dokumenty", "projekty", "media"]);

export const SharedDriveSchema = z.object({
	id: z.string().uuid(),
	deploymentId: z.string().uuid(),
	name: z.string(),
	category: SharedDriveCategorySchema,
	googleDriveId: z.string().nullable(),
	createdAt: z.coerce.date(),
});

export const SharedDriveUpsertRequestSchema = z.object({
	name: z.string().min(1, "Nazwa dysku jest wymagana"),
	category: SharedDriveCategorySchema,
	googleDriveId: z.string().nullable().optional(),
});

export const SharedDriveBulkUpsertRequestSchema = z.object({
	drives: z
		.array(SharedDriveUpsertRequestSchema)
		.min(1)
		.max(3)
		.refine((drives) => new Set(drives.map((d) => d.category)).size === drives.length, {
			message: "Kategorie musza byc unikalne",
		}),
});

export const SharedDriveCreateRequestSchema = z.object({
	drives: z
		.array(
			z.object({
				name: z.string().min(1, "Nazwa dysku jest wymagana"),
				category: SharedDriveCategorySchema,
			}),
		)
		.min(1)
		.max(3)
		.refine((drives) => new Set(drives.map((d) => d.category)).size === drives.length, {
			message: "Kategorie musza byc unikalne",
		}),
});

export type SharedDriveCreateInput = z.infer<typeof SharedDriveCreateRequestSchema>;

export const SharedDriveListResponseSchema = z.object({
	data: z.array(SharedDriveSchema),
});

export const SharedDriveDeploymentParamSchema = z.object({
	deploymentId: z.string().uuid("Nieprawidlowy format ID"),
});

export type SharedDriveCategory = z.infer<typeof SharedDriveCategorySchema>;
export type SharedDrive = z.infer<typeof SharedDriveSchema>;
export type SharedDriveUpsertInput = z.infer<typeof SharedDriveUpsertRequestSchema>;
export type SharedDriveBulkUpsertInput = z.infer<typeof SharedDriveBulkUpsertRequestSchema>;
