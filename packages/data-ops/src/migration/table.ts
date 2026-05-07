import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { deployments } from "../deployment/table";
import { auth_user } from "../drizzle/auth-schema";

export const migrationJobTypeEnum = pgEnum("migration_job_type", [
	"backup",
	"migrate",
	"gdrive-restore",
]);

export const migrationJobStatusEnum = pgEnum("migration_job_status", [
	"queued",
	"running",
	"done",
	"failed",
]);

export const migrationJobs = pgTable(
	"migration_jobs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		deploymentId: uuid("deployment_id")
			.notNull()
			.references(() => deployments.id, { onDelete: "cascade" }),
		type: migrationJobTypeEnum("type").notNull(),
		account: text("account"),
		dryRun: boolean("dry_run").notNull().default(false),
		status: migrationJobStatusEnum("status").notNull().default("queued"),
		runnerJobId: uuid("runner_job_id").notNull(),
		startedAt: timestamp("started_at").defaultNow().notNull(),
		finishedAt: timestamp("finished_at"),
		exitCode: integer("exit_code"),
		triggeredByUserId: text("triggered_by_user_id")
			.notNull()
			.references(() => auth_user.id, { onDelete: "restrict" }),
	},
	(table) => ({
		deploymentStartedIdx: index("migration_jobs_deployment_started_idx").on(
			table.deploymentId,
			table.startedAt.desc(),
		),
	}),
);
