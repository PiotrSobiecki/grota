import { relations } from "drizzle-orm/relations";
import { deployments } from "../deployment/table";
import { employees } from "../employee/table";
import { auth_user } from "./auth-schema";

export const deploymentRelations = relations(deployments, ({ one, many }) => ({
	operator: one(auth_user, {
		fields: [deployments.createdBy],
		references: [auth_user.id],
	}),
	employees: many(employees),
}));

export const employeeRelations = relations(employees, ({ one }) => ({
	deployment: one(deployments, {
		fields: [employees.deploymentId],
		references: [deployments.id],
	}),
}));
