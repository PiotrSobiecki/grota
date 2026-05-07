CREATE TYPE "public"."migration_job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."migration_job_type" AS ENUM('backup', 'migrate');--> statement-breakpoint
CREATE TABLE "migration_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"type" "migration_job_type" NOT NULL,
	"account" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"status" "migration_job_status" DEFAULT 'queued' NOT NULL,
	"runner_job_id" uuid NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"exit_code" integer,
	"triggered_by_user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_triggered_by_user_id_auth_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "migration_jobs_deployment_started_idx" ON "migration_jobs" USING btree ("deployment_id","started_at" DESC NULLS LAST);