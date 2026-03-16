-- Phase 1d: Remove hardcoded categories, make shared drives dynamic

-- Add retention_days to shared_drives
ALTER TABLE "shared_drives" ADD COLUMN "retention_days" integer;

-- Add shared_drive_id FK to folder_selections
ALTER TABLE "folder_selections" ADD COLUMN "shared_drive_id" uuid;

-- Data migration: link existing folder_selections to shared_drives by category
UPDATE "folder_selections" fs SET "shared_drive_id" = (
  SELECT sd.id FROM "shared_drives" sd
  JOIN "employees" e ON e."deployment_id" = sd."deployment_id"
  WHERE e.id = fs."employee_id" AND sd."category" = fs."category"
) WHERE fs."category" != 'prywatne';

-- Drop old category column from folder_selections
ALTER TABLE "folder_selections" DROP COLUMN "category";

-- Drop old unique constraint and category column from shared_drives
ALTER TABLE "shared_drives" DROP CONSTRAINT "shared_drives_deployment_id_category_unique";
ALTER TABLE "shared_drives" DROP COLUMN "category";

-- Add new unique constraint on (deployment_id, name)
ALTER TABLE "shared_drives" ADD CONSTRAINT "shared_drives_deployment_id_name_unique" UNIQUE("deployment_id","name");

-- Add FK constraint for shared_drive_id
ALTER TABLE "folder_selections" ADD CONSTRAINT "folder_selections_shared_drive_id_shared_drives_id_fk" FOREIGN KEY ("shared_drive_id") REFERENCES "public"."shared_drives"("id") ON DELETE set null ON UPDATE no action;

-- Drop the enum type
DROP TYPE IF EXISTS "public"."folder_category";
