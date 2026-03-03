CREATE TABLE "deployment_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_deployment_slug" UNIQUE("deployment_id","slug")
);
--> statement-breakpoint
CREATE TABLE "employee_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_employee_department" UNIQUE("employee_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "deployment_departments" ADD CONSTRAINT "deployment_departments_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_department_id_deployment_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."deployment_departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."employee_role";