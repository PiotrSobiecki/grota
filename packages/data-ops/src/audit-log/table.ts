import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { deployments } from "../deployment/table";
import { auth_user } from "../drizzle/auth-schema";

export const serverConfigAuditLog = pgTable(
	"server_config_audit_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		deploymentId: uuid("deployment_id")
			.notNull()
			.references(() => deployments.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => auth_user.id, { onDelete: "restrict" }),
		changedFields: text("changed_fields").array().notNull(),
		changedAt: timestamp("changed_at").defaultNow().notNull(),
	},
	(table) => ({
		deploymentChangedIdx: index("server_config_audit_log_deployment_changed_idx").on(
			table.deploymentId,
			table.changedAt.desc(),
		),
	}),
);

export const scheduleAuditLog = pgTable(
	"schedule_audit_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		deploymentId: uuid("deployment_id")
			.notNull()
			.references(() => deployments.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => auth_user.id, { onDelete: "restrict" }),
		action: text("action").notNull(),
		diff: jsonb("diff").notNull(),
		changedAt: timestamp("changed_at").defaultNow().notNull(),
	},
	(table) => ({
		deploymentChangedIdx: index("schedule_audit_log_deployment_changed_idx").on(
			table.deploymentId,
			table.changedAt.desc(),
		),
	}),
);
