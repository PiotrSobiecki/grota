import { z } from "zod";

// ============================================
// Domain Model
// ============================================

export const FolderSelectionSchema = z.object({
	id: z.string().uuid(),
	employeeId: z.string().uuid(),
	folderId: z.string(),
	folderName: z.string(),
	sharedDriveId: z.string().uuid().nullable(),
	createdAt: z.coerce.date(),
});

// ============================================
// Request Schemas
// ============================================

export const FolderSelectionCreateRequestSchema = z.object({
	folderId: z.string().min(1, "ID folderu jest wymagane"),
	folderName: z.string().min(1, "Nazwa folderu jest wymagana"),
	sharedDriveId: z.string().uuid().nullable(),
});

export const FolderSelectionBulkCreateRequestSchema = z.object({
	employeeId: z.string().uuid(),
	selections: z
		.array(FolderSelectionCreateRequestSchema)
		.min(1, "Wybierz przynajmniej jeden folder"),
});

// ============================================
// Response Schemas
// ============================================

export const FolderSelectionResponseSchema = FolderSelectionSchema;

export const FolderSelectionListResponseSchema = z.object({
	data: z.array(FolderSelectionSchema),
	total: z.number(),
});

/** Google Drive folder item as returned from the API */
export const DriveFolderSchema = z.object({
	id: z.string(),
	name: z.string(),
	mimeType: z.string(),
});

export const DriveFolderListResponseSchema = z.object({
	folders: z.array(DriveFolderSchema),
});

// ============================================
// Types
// ============================================

export type FolderSelection = z.infer<typeof FolderSelectionSchema>;
export type FolderSelectionCreateInput = z.infer<typeof FolderSelectionCreateRequestSchema>;
export type FolderSelectionBulkCreateInput = z.infer<typeof FolderSelectionBulkCreateRequestSchema>;
export type DriveFolder = z.infer<typeof DriveFolderSchema>;
