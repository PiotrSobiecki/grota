import { type Department, getEmployeeDepartments } from "@repo/data-ops/department";
import { updateDeploymentStatus } from "@repo/data-ops/deployment";
import {
	createEmployees,
	type Employee,
	type EmployeeCreateInput,
	getEmployeesByDeployment as getEmployeesQuery,
} from "@repo/data-ops/employee";
import type { Result } from "../types/result";

interface EmployeeWithDepartments extends Employee {
	departments: Department[];
}

export async function getEmployeesByDeployment(
	deploymentId: string,
): Promise<Result<{ data: EmployeeWithDepartments[]; total: number }>> {
	const employees = await getEmployeesQuery(deploymentId);

	const data = await Promise.all(
		employees.map(async (emp) => {
			const departments = await getEmployeeDepartments(emp.id);
			return { ...emp, departments };
		}),
	);

	return { ok: true, data: { data, total: data.length } };
}

export async function bulkCreateEmployees(
	deploymentId: string,
	employeeData: EmployeeCreateInput[],
	_env: Env,
): Promise<Result<Employee[]>> {
	const created = await createEmployees(deploymentId, employeeData);

	// Transition deployment status
	await updateDeploymentStatus(deploymentId, "employees_pending");

	return { ok: true, data: created };
}
