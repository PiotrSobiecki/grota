import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import { assignEmployeeDepartments } from "@/department/queries";
import type { Employee, EmployeeCreateInput } from "./schema";
import { employees } from "./table";

export async function getEmployeesByDeployment(deploymentId: string): Promise<Employee[]> {
	const db = getDb();
	return db.select().from(employees).where(eq(employees.deploymentId, deploymentId));
}

export async function getEmployeeByToken(token: string): Promise<Employee | null> {
	const db = getDb();
	const result = await db.select().from(employees).where(eq(employees.magicLinkToken, token));
	return result[0] ?? null;
}

export async function getEmployeeById(employeeId: string): Promise<Employee | null> {
	const db = getDb();
	const result = await db.select().from(employees).where(eq(employees.id, employeeId));
	return result[0] ?? null;
}

export async function createEmployees(
	deploymentId: string,
	data: EmployeeCreateInput[],
): Promise<Employee[]> {
	const db = getDb();
	const values = data.map((emp) => ({
		deploymentId,
		email: emp.email,
		name: emp.name,
	}));
	const created = await db.insert(employees).values(values).returning();

	// Assign departments M:N
	await Promise.all(
		created.map((employee, i) => {
			const input = data[i];
			if (!input) return Promise.resolve();
			return assignEmployeeDepartments(employee.id, input.departmentIds);
		}),
	);

	return created;
}

export async function updateEmployeeMagicLink(
	employeeId: string,
	token: string,
	expiresAt: Date,
): Promise<Employee | null> {
	const db = getDb();
	const result = await db
		.update(employees)
		.set({
			magicLinkToken: token,
			magicLinkExpiresAt: expiresAt,
			magicLinkSentAt: new Date(),
		})
		.where(eq(employees.id, employeeId))
		.returning();
	return result[0] ?? null;
}

export async function updateEmployeeOAuthStatus(
	employeeId: string,
	status: "pending" | "authorized" | "failed",
): Promise<Employee | null> {
	const db = getDb();
	const result = await db
		.update(employees)
		.set({ oauthStatus: status })
		.where(eq(employees.id, employeeId))
		.returning();
	return result[0] ?? null;
}

export async function updateEmployeeSelectionStatus(
	employeeId: string,
	status: "pending" | "in_progress" | "completed",
): Promise<Employee | null> {
	const db = getDb();
	const result = await db
		.update(employees)
		.set({ selectionStatus: status })
		.where(eq(employees.id, employeeId))
		.returning();
	return result[0] ?? null;
}
