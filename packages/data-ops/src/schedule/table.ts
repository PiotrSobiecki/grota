import { boolean, integer, pgTable, text, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { deployments } from "../deployment/table";
import { migrationJobs } from "../migration/table";

export const deploymentSchedules = pgTable("deployment_schedules", {
	deploymentId: uuid("deployment_id")
		.primaryKey()
		.references(() => deployments.id, { onDelete: "cascade" }),
	enabled: boolean("enabled").notNull().default(false),
	intervalHours: integer("interval_hours").notNull().default(24),
	anchorTime: time("anchor_time").notNull().default("02:00"),
	anchorTimezone: text("anchor_timezone").notNull().default("Europe/Warsaw"),
	lastRunAt: timestamp("last_run_at"),
	nextRunAt: timestamp("next_run_at"),
	lastJobId: uuid("last_job_id").references(() => migrationJobs.id, { onDelete: "set null" }),
	lastStatus: text("last_status"),
	retryAttemptsRemaining: integer("retry_attempts_remaining").notNull().default(0),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});
