import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { deployments } from "../deployment/table";

export const sharedDrives = pgTable(
	"shared_drives",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		deploymentId: uuid("deployment_id")
			.notNull()
			.references(() => deployments.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		googleDriveId: text("google_drive_id"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [unique().on(t.deploymentId, t.name)],
);
