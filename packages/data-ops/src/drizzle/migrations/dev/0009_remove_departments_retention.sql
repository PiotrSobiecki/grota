-- Remove departments and retention

DROP TABLE IF EXISTS "employee_departments";
DROP TABLE IF EXISTS "deployment_departments";
ALTER TABLE "shared_drives" DROP COLUMN IF EXISTS "retention_days";
