import { type Department, getEmployeeDepartments } from "@repo/data-ops/department";
import {
	getDeployment,
	updateDeploymentStatus,
	updateOnboardingStep,
} from "@repo/data-ops/deployment";
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
	env: Env,
): Promise<Result<Employee[]>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie znalezione", status: 404 },
		};
	}

	if (deployment.status === "ready" || deployment.status === "active") {
		return {
			ok: false,
			error: {
				code: "DEPLOYMENT_LOCKED",
				message: "Onboarding zakonczony — nie mozna dodawac pracownikow",
				status: 403,
			},
		};
	}

	const created = await createEmployees(deploymentId, employeeData);

	await Promise.all([
		updateDeploymentStatus(deploymentId, "employees_pending"),
		updateOnboardingStep(deploymentId, 5),
	]);

	const clientName = deployment.clientName;
	const msg = [
		"Grota: Admin zakonczyl onboarding",
		`Klient: ${clientName}`,
		`Pracownikow: ${created.length}`,
		`Deployment: ${deploymentId}`,
		"Akcja: wyslij linki do pracownikow z panelu",
	].join("\n");

	try {
		await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: env.TELEGRAM_CHAT_ID,
				text: msg,
			}),
		});
	} catch {
		// best-effort, don't fail the create
	}

	return { ok: true, data: created };
}
