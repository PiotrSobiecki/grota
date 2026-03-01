import { relations } from "drizzle-orm/relations";
import { deployments } from "../deployment/table";
import { auth_user } from "./auth-schema";

export const deploymentRelations = relations(deployments, ({ one }) => ({
	operator: one(auth_user, {
		fields: [deployments.createdBy],
		references: [auth_user.id],
	}),
}));
