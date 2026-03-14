CREATE TABLE "shared_drives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "folder_category" NOT NULL,
	"google_drive_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shared_drives_deployment_id_category_unique" UNIQUE("deployment_id","category")
);
--> statement-breakpoint
ALTER TABLE "shared_drives" ADD CONSTRAINT "shared_drives_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;