import {
	createDepartment,
	createDepartmentsBulk,
	type Department,
	type DepartmentCreateInput,
	type DepartmentUpdateInput,
	deleteDepartment,
	getDepartmentsByDeployment as getDepartmentsQuery,
	MAX_DEPARTMENTS_PER_DEPLOYMENT,
	updateDepartment,
} from "@repo/data-ops/department";
import type { Result } from "../types/result";

export async function getDepartmentsByDeployment(
	deploymentId: string,
): Promise<Result<{ data: Department[]; total: number }>> {
	const data = await getDepartmentsQuery(deploymentId);
	return { ok: true, data: { data, total: data.length } };
}

export async function createDeploymentDepartment(
	deploymentId: string,
	input: DepartmentCreateInput,
): Promise<Result<Department>> {
	const existing = await getDepartmentsQuery(deploymentId);
	if (existing.length >= MAX_DEPARTMENTS_PER_DEPLOYMENT) {
		return {
			ok: false,
			error: {
				code: "MAX_DEPARTMENTS_REACHED",
				message: `Maksymalnie ${MAX_DEPARTMENTS_PER_DEPLOYMENT} dzialow na wdrozenie`,
				status: 400,
			},
		};
	}

	const department = await createDepartment(deploymentId, input, existing.length);
	return { ok: true, data: department };
}

export async function createDeploymentDepartmentsBulk(
	deploymentId: string,
	departments: DepartmentCreateInput[],
): Promise<Result<Department[]>> {
	const existing = await getDepartmentsQuery(deploymentId);
	if (existing.length + departments.length > MAX_DEPARTMENTS_PER_DEPLOYMENT) {
		return {
			ok: false,
			error: {
				code: "MAX_DEPARTMENTS_REACHED",
				message: `Maksymalnie ${MAX_DEPARTMENTS_PER_DEPLOYMENT} dzialow na wdrozenie`,
				status: 400,
			},
		};
	}

	const created = await createDepartmentsBulk(deploymentId, departments);
	return { ok: true, data: created };
}

export async function updateDeploymentDepartment(
	departmentId: string,
	input: DepartmentUpdateInput,
): Promise<Result<Department>> {
	const updated = await updateDepartment(departmentId, input);
	if (!updated) {
		return {
			ok: false,
			error: {
				code: "DEPARTMENT_NOT_FOUND",
				message: "Dzial nie zostal znaleziony",
				status: 404,
			},
		};
	}
	return { ok: true, data: updated };
}

export async function deleteDeploymentDepartment(departmentId: string): Promise<Result<boolean>> {
	const deleted = await deleteDepartment(departmentId);
	if (!deleted) {
		return {
			ok: false,
			error: {
				code: "DEPARTMENT_NOT_FOUND",
				message: "Dzial nie zostal znaleziony",
				status: 404,
			},
		};
	}
	return { ok: true, data: true };
}
