CREATE TABLE "server_config_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"changed_fields" text[] NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server_config_audit_log" ADD CONSTRAINT "server_config_audit_log_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_config_audit_log" ADD CONSTRAINT "server_config_audit_log_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_config_audit_log_deployment_changed_idx" ON "server_config_audit_log" USING btree ("deployment_id","changed_at" DESC NULLS LAST);