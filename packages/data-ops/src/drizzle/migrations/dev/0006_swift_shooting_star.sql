CREATE TYPE "public"."folder_category" AS ENUM('dokumenty', 'projekty', 'media', 'prywatne');--> statement-breakpoint
CREATE TABLE "folder_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"folder_id" text NOT NULL,
	"folder_name" text NOT NULL,
	"category" "folder_category" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "folder_selections" ADD CONSTRAINT "folder_selections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;