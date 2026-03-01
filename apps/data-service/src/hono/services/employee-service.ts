import { updateDeploymentStatus } from "@repo/data-ops/deployment";
import {
	createEmployees,
	type Employee,
	type EmployeeCreateInput,
	getEmployeesByDeployment as getEmployeesQuery,
} from "@repo/data-ops/employee";
import type { Result } from "../types/result";

export async function getEmployeesByDeployment(
	deploymentId: string,
): Promise<Result<{ data: Employee[]; total: number }>> {
	const data = await getEmployeesQuery(deploymentId);
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
