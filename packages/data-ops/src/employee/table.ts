import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { deployments } from "../deployment/table";

export const oauthStatusEnum = pgEnum("oauth_status", ["pending", "authorized", "failed"]);

export const selectionStatusEnum = pgEnum("selection_status", [
	"pending",
	"in_progress",
	"completed",
]);

export const employees = pgTable("employees", {
	id: uuid("id").defaultRandom().primaryKey(),
	deploymentId: uuid("deployment_id")
		.notNull()
		.references(() => deployments.id, { onDelete: "cascade" }),
	email: text("email").notNull(),
	name: text("name").notNull(),
	oauthStatus: oauthStatusEnum("oauth_status").notNull().default("pending"),
	selectionStatus: selectionStatusEnum("selection_status").notNull().default("pending"),

	// OAuth token added in doc 004 (encrypted)
	driveOauthToken: text("drive_oauth_token"),

	// Magic link
	magicLinkToken: text("magic_link_token"),
	magicLinkExpiresAt: timestamp("magic_link_expires_at"),
	magicLinkSentAt: timestamp("magic_link_sent_at"),

	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});
