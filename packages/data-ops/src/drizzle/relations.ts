import { relations } from "drizzle-orm/relations";
import { deploymentDepartments, employeeDepartments } from "../department/table";
import { deployments } from "../deployment/table";
import { employees } from "../employee/table";
import { auth_user } from "./auth-schema";

export const deploymentRelations = relations(deployments, ({ one, many }) => ({
	operator: one(auth_user, {
		fields: [deployments.createdBy],
		references: [auth_user.id],
	}),
	employees: many(employees),
	departments: many(deploymentDepartments),
}));

export const employeeRelations = relations(employees, ({ one, many }) => ({
	deployment: one(deployments, {
		fields: [employees.deploymentId],
		references: [deployments.id],
	}),
	employeeDepartments: many(employeeDepartments),
}));

export const deploymentDepartmentRelations = relations(deploymentDepartments, ({ one, many }) => ({
	deployment: one(deployments, {
		fields: [deploymentDepartments.deploymentId],
		references: [deployments.id],
	}),
	employeeDepartments: many(employeeDepartments),
}));

export const employeeDepartmentRelations = relations(employeeDepartments, ({ one }) => ({
	employee: one(employees, {
		fields: [employeeDepartments.employeeId],
		references: [employees.id],
	}),
	department: one(deploymentDepartments, {
		fields: [employeeDepartments.departmentId],
		references: [deploymentDepartments.id],
	}),
}));
