import { and, eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { Department, DepartmentCreateInput } from "./schema";
import { deploymentDepartments, employeeDepartments } from "./table";

function slugify(name: string): string {
	return name
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export async function getDepartmentsByDeployment(deploymentId: string): Promise<Department[]> {
	const db = getDb();
	return db
		.select()
		.from(deploymentDepartments)
		.where(eq(deploymentDepartments.deploymentId, deploymentId))
		.orderBy(deploymentDepartments.sortOrder);
}

export async function createDepartment(
	deploymentId: string,
	data: DepartmentCreateInput,
	sortOrder = 0,
): Promise<Department> {
	const db = getDb();
	const slug = slugify(data.name);
	const result = await db
		.insert(deploymentDepartments)
		.values({ deploymentId, name: data.name, slug, sortOrder })
		.returning();
	const row = result[0];
	if (!row) throw new Error("Failed to create department");
	return row;
}

export async function createDepartmentsBulk(
	deploymentId: string,
	departments: DepartmentCreateInput[],
): Promise<Department[]> {
	const db = getDb();
	const values = departments.map((d, i) => ({
		deploymentId,
		name: d.name,
		slug: slugify(d.name),
		sortOrder: i,
	}));
	return db.insert(deploymentDepartments).values(values).returning();
}

export async function deleteDepartment(departmentId: string): Promise<boolean> {
	const db = getDb();
	const result = await db
		.delete(deploymentDepartments)
		.where(eq(deploymentDepartments.id, departmentId))
		.returning();
	return result.length > 0;
}

export async function getDepartmentById(departmentId: string): Promise<Department | null> {
	const db = getDb();
	const result = await db
		.select()
		.from(deploymentDepartments)
		.where(eq(deploymentDepartments.id, departmentId));
	return result[0] ?? null;
}

export async function assignEmployeeDepartments(
	employeeId: string,
	departmentIds: string[],
): Promise<void> {
	const db = getDb();
	if (departmentIds.length === 0) return;
	const values = departmentIds.map((departmentId) => ({
		employeeId,
		departmentId,
	}));
	await db.insert(employeeDepartments).values(values).onConflictDoNothing();
}

export async function getEmployeeDepartments(employeeId: string): Promise<Department[]> {
	const db = getDb();
	const rows = await db
		.select({
			id: deploymentDepartments.id,
			deploymentId: deploymentDepartments.deploymentId,
			name: deploymentDepartments.name,
			slug: deploymentDepartments.slug,
			sortOrder: deploymentDepartments.sortOrder,
			createdAt: deploymentDepartments.createdAt,
		})
		.from(employeeDepartments)
		.innerJoin(
			deploymentDepartments,
			eq(employeeDepartments.departmentId, deploymentDepartments.id),
		)
		.where(eq(employeeDepartments.employeeId, employeeId));
	return rows;
}

export async function removeEmployeeDepartment(
	employeeId: string,
	departmentId: string,
): Promise<boolean> {
	const db = getDb();
	const result = await db
		.delete(employeeDepartments)
		.where(
			and(
				eq(employeeDepartments.employeeId, employeeId),
				eq(employeeDepartments.departmentId, departmentId),
			),
		)
		.returning();
	return result.length > 0;
}
