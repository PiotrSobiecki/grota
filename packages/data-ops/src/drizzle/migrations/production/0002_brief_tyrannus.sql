CREATE TYPE "public"."item_type" AS ENUM('folder', 'file');--> statement-breakpoint
ALTER TABLE "deployment_departments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_departments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "deployment_departments" CASCADE;--> statement-breakpoint
DROP TABLE "employee_departments" CASCADE;--> statement-breakpoint
ALTER TABLE "folder_selections" RENAME COLUMN "folder_id" TO "item_id";--> statement-breakpoint
ALTER TABLE "folder_selections" RENAME COLUMN "folder_name" TO "item_name";--> statement-breakpoint
ALTER TABLE "shared_drives" DROP CONSTRAINT "shared_drives_deployment_id_category_unique";--> statement-breakpoint
ALTER TABLE "folder_selections" ADD COLUMN "item_type" "item_type" DEFAULT 'folder' NOT NULL;--> statement-breakpoint
ALTER TABLE "folder_selections" ADD COLUMN "parent_folder_id" text;--> statement-breakpoint
ALTER TABLE "folder_selections" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "folder_selections" ADD COLUMN "shared_drive_id" uuid;--> statement-breakpoint
ALTER TABLE "folder_selections" ADD CONSTRAINT "folder_selections_shared_drive_id_shared_drives_id_fk" FOREIGN KEY ("shared_drive_id") REFERENCES "public"."shared_drives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_selections" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "shared_drives" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "shared_drives" ADD CONSTRAINT "shared_drives_deployment_id_name_unique" UNIQUE("deployment_id","name");--> statement-breakpoint
DROP TYPE "public"."folder_category";