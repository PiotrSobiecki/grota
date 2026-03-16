-- 0011: drill-in file/folder selection (doc 004)
-- Rename folder_id -> item_id, folder_name -> item_name
-- Add item_type enum, parent_folder_id, mime_type

CREATE TYPE "public"."item_type" AS ENUM('folder', 'file');--> statement-breakpoint
ALTER TABLE "folder_selections" RENAME COLUMN "folder_id" TO "item_id";--> statement-breakpoint
ALTER TABLE "folder_selections" RENAME COLUMN "folder_name" TO "item_name";--> statement-breakpoint
ALTER TABLE "folder_selections" ADD COLUMN "item_type" "item_type" DEFAULT 'folder' NOT NULL;--> statement-breakpoint
ALTER TABLE "folder_selections" ADD COLUMN "parent_folder_id" text;--> statement-breakpoint
ALTER TABLE "folder_selections" ADD COLUMN "mime_type" text;
