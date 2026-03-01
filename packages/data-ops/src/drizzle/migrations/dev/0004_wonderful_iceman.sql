CREATE TYPE "public"."employee_role" AS ENUM('zarzad', 'ksiegowosc', 'projekty', 'media');--> statement-breakpoint
CREATE TYPE "public"."oauth_status" AS ENUM('pending', 'authorized', 'failed');--> statement-breakpoint
CREATE TYPE "public"."selection_status" AS ENUM('pending', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "employee_role" NOT NULL,
	"oauth_status" "oauth_status" DEFAULT 'pending' NOT NULL,
	"selection_status" "selection_status" DEFAULT 'pending' NOT NULL,
	"drive_oauth_token" text,
	"magic_link_token" text,
	"magic_link_expires_at" timestamp,
	"magic_link_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "onboarding_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;