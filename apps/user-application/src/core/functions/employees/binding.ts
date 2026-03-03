import { env } from "cloudflare:workers";
import type { EmployeeCreateInput } from "@repo/data-ops/employee";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { protectedFunctionMiddleware } from "@/core/middleware/auth";
import { fetchDataService } from "@/lib/data-service";

interface EmployeeWithDepartments {
	id: string;
	deploymentId: string;
	email: string;
	name: string;
	oauthStatus: string;
	selectionStatus: string;
	magicLinkExpiresAt: string | null;
	magicLinkSentAt: string | null;
	createdAt: string;
	updatedAt: string;
	departments: Array<{
		id: string;
		deploymentId: string;
		name: string;
		slug: string;
		sortOrder: number;
		createdAt: string;
	}>;
}

interface EmployeeListWithDepartments {
	data: EmployeeWithDepartments[];
	total: number;
}

/** List employees for a deployment (called from status page and deployment detail). */
export const getEmployeesByDeployment = createServerFn({ method: "GET" })
	.inputValidator(z.object({ deploymentId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/employees/deployment/${data.deploymentId}`);

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie pobrac listy pracownikow",
				body.code ?? "EMPLOYEE_LIST_ERROR",
				response.status,
			);
		}

		return (await response.json()) as EmployeeListWithDepartments;
	});

/** Bulk create employees (called from wizard step 4). */
export const bulkCreateEmployees = createServerFn({ method: "POST" })
	.inputValidator(
		z.object({
			deploymentId: z.string().uuid(),
			employees: z.array(
				z.object({
					email: z.string().email(),
					name: z.string().min(1),
					departmentIds: z.array(z.string().uuid()).min(1),
				}),
			),
		}),
	)
	.handler(async ({ data }) => {
		const response = await fetchDataService("/employees/bulk", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie utworzyc pracownikow",
				body.code ?? "EMPLOYEE_CREATE_ERROR",
				response.status,
			);
		}

		return (await response.json()) as EmployeeCreateInput[];
	});

/** Send magic links to all employees in a deployment (operator action). */
export const sendEmployeeMagicLinks = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(z.object({ deploymentId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/magic-links/employees/${data.deploymentId}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.VITE_API_TOKEN}`,
			},
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie wyslac linkow",
				body.code ?? "MAGIC_LINK_ERROR",
				response.status,
			);
		}

		return (await response.json()) as { sent: number };
	});

/** Resend a single employee magic link (public, rate-limited). */
export const resendEmployeeMagicLink = createServerFn({ method: "POST" })
	.inputValidator(z.object({ employeeId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/magic-links/resend/${data.employeeId}`, {
			method: "POST",
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie wyslac linku",
				body.code ?? "RESEND_ERROR",
				response.status,
			);
		}

		return (await response.json()) as { sent: boolean };
	});

/** Verify employee token (public). */
export const verifyEmployeeToken = createServerFn({ method: "GET" })
	.inputValidator(z.object({ token: z.string().min(1) }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/magic-links/verify/employee/${data.token}`);

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nieprawidlowy lub wygasly link",
				body.code ?? "TOKEN_ERROR",
				response.status,
			);
		}

		return (await response.json()) as { employeeId: string; deploymentId: string };
	});
