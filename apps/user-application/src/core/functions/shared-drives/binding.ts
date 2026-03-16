import type { SharedDrive } from "@repo/data-ops/shared-drive";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { fetchDataService } from "@/lib/data-service";

export const getSharedDrives = createServerFn({ method: "GET" })
	.inputValidator(z.object({ deploymentId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/shared-drives/${data.deploymentId}`);
		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie pobrac dyskow wspoldzielonych",
				body.code ?? "SHARED_DRIVES_LIST_ERROR",
				response.status,
			);
		}
		return (await response.json()) as { data: SharedDrive[] };
	});

export const saveSharedDrives = createServerFn({ method: "POST" })
	.inputValidator(
		z.object({
			deploymentId: z.string().uuid(),
			drives: z.array(
				z.object({
					name: z.string().min(1),
					retentionDays: z.number().int().positive().nullable().optional(),
				}),
			),
		}),
	)
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/shared-drives/${data.deploymentId}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ drives: data.drives }),
		});
		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie zapisac dyskow wspoldzielonych",
				body.code ?? "SHARED_DRIVES_SAVE_ERROR",
				response.status,
			);
		}
		return (await response.json()) as SharedDrive[];
	});

interface CreateAndSaveResponse {
	created: SharedDrive[];
	failures: Array<{ name: string; error: string }>;
}

export const createAndSaveSharedDrives = createServerFn({ method: "POST" })
	.inputValidator(
		z.object({
			deploymentId: z.string().uuid(),
			drives: z.array(
				z.object({
					name: z.string().min(1),
					retentionDays: z.number().int().positive().nullable().optional(),
				}),
			),
		}),
	)
	.handler(async ({ data }) => {
		const response = await fetchDataService(`/shared-drives/${data.deploymentId}/create`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ drives: data.drives }),
		});
		if (!response.ok) {
			const body = (await response.json()) as { error?: string; code?: string };
			throw new AppError(
				body.error ?? "Nie udalo sie utworzyc dyskow wspoldzielonych",
				body.code ?? "SHARED_DRIVES_CREATE_ERROR",
				response.status,
			);
		}
		return (await response.json()) as CreateAndSaveResponse;
	});
