import { env } from "cloudflare:workers";
import type { EmployeeCreateInput } from "@repo/data-ops/employee";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { protectedFunctionMiddleware } from "@/core/middleware/auth";
import { fetchDataService } from "@/lib/data-service";

interface EmployeeListItem {
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
}

interface EmployeeListResponse {
	data: EmployeeListItem[];
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

		return (await response.json()) as EmployeeListResponse;
	});

/** Bulk create employees (called from wizard step 4). */
export const bulkCreateEmployees = createServerFn({ method: "POST" })
	.inputValidator(
		z.object({
			deploymentId: z.string().uuid(),
			employees: z.array(
				z.object({
					email: z.string().email(),
					name: z.string().optional().default(""),
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

/** Create single employee (post-onboarding addition from admin panel). */
export const createEmployee = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(
		z.object({
			deploymentId: z.string().uuid(),
			email: z.string().email("Nieprawidlowy format email"),
			name: z.string().max(100).optional().default(""),
		}),
	)
	.handler(async ({ data }) => {
		const response = await fetchDataService("/employees", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.VITE_API_TOKEN}`,
			},
			body: JSON.stringify(data),
		});
		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie dodac pracownika",
				body.code ?? "EMPLOYEE_CREATE_ERROR",
				response.status,
			);
		}
		return (await response.json()) as EmployeeListItem;
	});

/** Update employee email/name (admin action -- always allowed). */
export const updateEmployee = createServerFn({ method: "POST" })
	.middleware([protectedFunctionMiddleware])
	.inputValidator(
		z
			.object({
				employeeId: z.string().uuid(),
				email: z.string().email("Nieprawidlowy format email").optional(),
				name: z.string().max(100).optional(),
			})
			.refine((d) => d.email !== undefined || d.name !== undefined, {
				message: "Co najmniej jedno pole musi byc podane",
			}),
	)
	.handler(async ({ data }) => {
		const { employeeId, ...updates } = data;
		const response = await fetchDataService(`/employees/${employeeId}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.VITE_API_TOKEN}`,
			},
			body: JSON.stringify(updates),
		});
		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie zaktualizowac pracownika",
				body.code ?? "EMPLOYEE_UPDATE_ERROR",
				response.status,
			);
		}
		return (await response.json()) as EmployeeListItem;
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

		return (await response.json()) as {
			employeeId: string;
			deploymentId: string;
			sharedDrives: Array<{ id: string; name: string }>;
		};
	});
