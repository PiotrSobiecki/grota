import {
	getDeployment,
	updateDeploymentStatus,
	updateOnboardingStep,
} from "@repo/data-ops/deployment";
import {
	createEmployee as createEmployeeQuery,
	createEmployees,
	type Employee,
	type EmployeeCreateInput,
	type EmployeeUpdateInput,
	getEmployeeById,
	getEmployeesByDeployment as getEmployeesQuery,
	updateEmployee as updateEmployeeQuery,
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

export async function createSingleEmployee(
	deploymentId: string,
	input: EmployeeCreateInput,
): Promise<Result<Employee>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie znalezione", status: 404 },
		};
	}
	const created = await createEmployeeQuery(deploymentId, input);
	return { ok: true, data: created };
}

export async function updateEmployee(
	employeeId: string,
	updates: EmployeeUpdateInput,
): Promise<Result<Employee>> {
	const existing = await getEmployeeById(employeeId);
	if (!existing) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Pracownik nie znaleziony", status: 404 },
		};
	}
	const updated = await updateEmployeeQuery(employeeId, updates);
	if (!updated) {
		return {
			ok: false,
			error: { code: "UPDATE_FAILED", message: "Nie udalo sie zaktualizowac", status: 500 },
		};
	}
	return { ok: true, data: updated };
}
