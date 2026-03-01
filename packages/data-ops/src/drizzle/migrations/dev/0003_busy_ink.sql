CREATE TYPE "public"."deployment_status" AS ENUM('draft', 'onboarding', 'employees_pending', 'ready', 'active');--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_name" text NOT NULL,
	"domain" text NOT NULL,
	"status" "deployment_status" DEFAULT 'draft' NOT NULL,
	"admin_email" text,
	"admin_name" text,
	"admin_magic_link_token" text,
	"admin_magic_link_expires_at" timestamp,
	"workspace_oauth_token" text,
	"b2_config" jsonb,
	"server_config" jsonb,
	"r2_config_key" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;