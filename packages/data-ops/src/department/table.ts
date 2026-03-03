import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { deployments } from "../deployment/table";
import { employees } from "../employee/table";

export const deploymentDepartments = pgTable(
	"deployment_departments",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		deploymentId: uuid("deployment_id")
			.notNull()
			.references(() => deployments.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [unique("uq_deployment_slug").on(t.deploymentId, t.slug)],
);

export const employeeDepartments = pgTable(
	"employee_departments",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employees.id, { onDelete: "cascade" }),
		departmentId: uuid("department_id")
			.notNull()
			.references(() => deploymentDepartments.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [unique("uq_employee_department").on(t.employeeId, t.departmentId)],
);
