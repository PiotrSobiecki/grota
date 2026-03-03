import type { Department, DepartmentListResponse } from "@repo/data-ops/department";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { fetchDataService } from "@/lib/data-service";

export const getDepartments = createServerFn({ method: "GET" })
	.inputValidator(z.object({ deploymentId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/departments/${data.deploymentId}`);

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie pobrac dzialow",
				body.code ?? "DEPARTMENT_LIST_ERROR",
				response.status,
			);
		}

		return (await response.json()) as DepartmentListResponse;
	});

export const createDepartment = createServerFn({ method: "POST" })
	.inputValidator(
		z.object({
			deploymentId: z.string().uuid(),
			name: z.string().min(1),
		}),
	)
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/departments/${data.deploymentId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: data.name }),
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie utworzyc dzialu",
				body.code ?? "DEPARTMENT_CREATE_ERROR",
				response.status,
			);
		}

		return (await response.json()) as Department;
	});

export const createDepartmentsBulk = createServerFn({ method: "POST" })
	.inputValidator(
		z.object({
			deploymentId: z.string().uuid(),
			departments: z.array(z.object({ name: z.string().min(1) })).min(1),
		}),
	)
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/departments/${data.deploymentId}/bulk`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ departments: data.departments }),
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie utworzyc dzialow",
				body.code ?? "DEPARTMENT_BULK_CREATE_ERROR",
				response.status,
			);
		}

		return (await response.json()) as Department[];
	});

export const deleteDepartment = createServerFn({ method: "POST" })
	.inputValidator(z.object({ departmentId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/departments/${data.departmentId}`, {
			method: "DELETE",
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie usunac dzialu",
				body.code ?? "DEPARTMENT_DELETE_ERROR",
				response.status,
			);
		}

		return true;
	});
