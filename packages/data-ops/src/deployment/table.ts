import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auth_user } from "../drizzle/auth-schema";
import type { B2Config, ServerConfig } from "./schema";

export const deploymentStatusEnum = pgEnum("deployment_status", [
	"draft",
	"onboarding",
	"employees_pending",
	"ready",
	"active",
]);

export const deployments = pgTable("deployments", {
	id: uuid("id").defaultRandom().primaryKey(),
	clientName: text("client_name").notNull(),
	domain: text("domain").notNull(),
	status: deploymentStatusEnum("status").notNull().default("draft"),

	// Client admin (resolves B1)
	adminEmail: text("admin_email"),
	adminName: text("admin_name"),
	adminMagicLinkToken: text("admin_magic_link_token"),
	adminMagicLinkExpiresAt: timestamp("admin_magic_link_expires_at"),

	// OAuth token (encrypted, added in doc 004)
	workspaceOauthToken: text("workspace_oauth_token"),

	// Config blobs
	b2Config: jsonb("b2_config").$type<B2Config | null>(),
	serverConfig: jsonb("server_config").$type<ServerConfig | null>(),

	// R2 reference
	r2ConfigKey: text("r2_config_key"),

	// Operator FK
	createdBy: text("created_by")
		.notNull()
		.references(() => auth_user.id, { onDelete: "restrict" }),

	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});
