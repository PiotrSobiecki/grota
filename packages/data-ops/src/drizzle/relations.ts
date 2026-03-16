import { relations } from "drizzle-orm/relations";
import { deployments } from "../deployment/table";
import { employees } from "../employee/table";
import { folderSelections } from "../folder-selection/table";
import { sharedDrives } from "../shared-drive/table";
import { auth_user } from "./auth-schema";

export const deploymentRelations = relations(deployments, ({ one, many }) => ({
	operator: one(auth_user, {
		fields: [deployments.createdBy],
		references: [auth_user.id],
	}),
	employees: many(employees),
	sharedDrives: many(sharedDrives),
}));

export const employeeRelations = relations(employees, ({ one, many }) => ({
	deployment: one(deployments, {
		fields: [employees.deploymentId],
		references: [deployments.id],
	}),
	folderSelections: many(folderSelections),
}));

export const folderSelectionRelations = relations(folderSelections, ({ one }) => ({
	employee: one(employees, {
		fields: [folderSelections.employeeId],
		references: [employees.id],
	}),
	sharedDrive: one(sharedDrives, {
		fields: [folderSelections.sharedDriveId],
		references: [sharedDrives.id],
	}),
}));

export const sharedDriveRelations = relations(sharedDrives, ({ one, many }) => ({
	deployment: one(deployments, {
		fields: [sharedDrives.deploymentId],
		references: [deployments.id],
	}),
	folderSelections: many(folderSelections),
}));
