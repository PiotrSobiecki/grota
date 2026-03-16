import { z } from "zod";

export const SharedDriveSchema = z.object({
	id: z.string().uuid(),
	deploymentId: z.string().uuid(),
	name: z.string(),
	retentionDays: z.number().int().positive().nullable(),
	googleDriveId: z.string().nullable(),
	createdAt: z.coerce.date(),
});

export const SharedDriveUpsertRequestSchema = z.object({
	name: z.string().min(1, "Nazwa dysku jest wymagana"),
	retentionDays: z.number().int().positive().nullable().optional(),
	googleDriveId: z.string().nullable().optional(),
});

export const SharedDriveBulkUpsertRequestSchema = z.object({
	drives: z
		.array(SharedDriveUpsertRequestSchema)
		.min(1)
		.refine((drives) => new Set(drives.map((d) => d.name)).size === drives.length, {
			message: "Nazwy dyskow musza byc unikalne",
		}),
});

export const SharedDriveCreateRequestSchema = z.object({
	drives: z
		.array(
			z.object({
				name: z.string().min(1, "Nazwa dysku jest wymagana"),
				retentionDays: z.number().int().positive().nullable().optional(),
			}),
		)
		.min(1)
		.refine((drives) => new Set(drives.map((d) => d.name)).size === drives.length, {
			message: "Nazwy dyskow musza byc unikalne",
		}),
});

export type SharedDriveCreateInput = z.infer<typeof SharedDriveCreateRequestSchema>;

export const SharedDriveListResponseSchema = z.object({
	data: z.array(SharedDriveSchema),
});

export const SharedDriveDeploymentParamSchema = z.object({
	deploymentId: z.string().uuid("Nieprawidlowy format ID"),
});

export type SharedDrive = z.infer<typeof SharedDriveSchema>;
export type SharedDriveUpsertInput = z.infer<typeof SharedDriveUpsertRequestSchema>;
export type SharedDriveBulkUpsertInput = z.infer<typeof SharedDriveBulkUpsertRequestSchema>;
