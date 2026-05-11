ALTER TABLE "deployment_schedules" ADD COLUMN "anchor_time" time DEFAULT '02:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment_schedules" ADD COLUMN "anchor_timezone" text DEFAULT 'Europe/Warsaw' NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment_schedules" ADD COLUMN "last_job_id" uuid;--> statement-breakpoint
ALTER TABLE "deployment_schedules" ADD COLUMN "last_status" text;--> statement-breakpoint
ALTER TABLE "deployment_schedules" ADD CONSTRAINT "deployment_schedules_last_job_id_migration_jobs_id_fk" FOREIGN KEY ("last_job_id") REFERENCES "public"."migration_jobs"("id") ON DELETE set null ON UPDATE no action;