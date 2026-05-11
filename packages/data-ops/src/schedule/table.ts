import { boolean, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { deployments } from "../deployment/table";

export const deploymentSchedules = pgTable("deployment_schedules", {
	deploymentId: uuid("deployment_id")
		.primaryKey()
		.references(() => deployments.id, { onDelete: "cascade" }),
	enabled: boolean("enabled").notNull().default(false),
	intervalHours: integer("interval_hours").notNull().default(24),
	lastRunAt: timestamp("last_run_at"),
	nextRunAt: timestamp("next_run_at"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});
