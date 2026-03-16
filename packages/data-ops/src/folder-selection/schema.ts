import { z } from "zod";

// ============================================
// Shared Enums
// ============================================

export const ItemTypeSchema = z.enum(["folder", "file"]);

// ============================================
// Domain Model
// ============================================

export const FolderSelectionSchema = z.object({
	id: z.string().uuid(),
	employeeId: z.string().uuid(),
	itemId: z.string(),
	itemName: z.string(),
	itemType: ItemTypeSchema,
	parentFolderId: z.string().nullable(),
	mimeType: z.string().nullable(),
	sharedDriveId: z.string().uuid().nullable(),
	createdAt: z.coerce.date(),
});

// ============================================
// Request Schemas
// ============================================

export const FolderSelectionCreateRequestSchema = z.object({
	itemId: z.string().min(1, "ID elementu jest wymagane"),
	itemName: z.string().min(1, "Nazwa elementu jest wymagana"),
	itemType: ItemTypeSchema,
	parentFolderId: z.string().nullable(),
	mimeType: z.string().nullable(),
	sharedDriveId: z.string().uuid().nullable(),
});

export const FolderSelectionBulkCreateRequestSchema = z.object({
	employeeId: z.string().uuid(),
	selections: z.array(FolderSelectionCreateRequestSchema).min(0),
});

// ============================================
// Response Schemas
// ============================================

export const FolderSelectionResponseSchema = FolderSelectionSchema;

export const FolderSelectionListResponseSchema = z.object({
	data: z.array(FolderSelectionSchema),
	total: z.number(),
});

/** Google Drive item (folder or file) as returned from the API */
export const DriveItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	mimeType: z.string(),
	type: z.enum(["folder", "file"]),
	size: z.number().nullable(),
});

export const DriveItemListQuerySchema = z.object({
	parentId: z.string().optional().default("root"),
	pageToken: z.string().optional(),
});

export const DriveItemListResponseSchema = z.object({
	items: z.array(DriveItemSchema),
	nextPageToken: z.string().nullable(),
});

// ============================================
// Types
// ============================================

export type FolderSelection = z.infer<typeof FolderSelectionSchema>;
export type FolderSelectionCreateInput = z.infer<typeof FolderSelectionCreateRequestSchema>;
export type FolderSelectionBulkCreateInput = z.infer<typeof FolderSelectionBulkCreateRequestSchema>;
export type DriveItem = z.infer<typeof DriveItemSchema>;
