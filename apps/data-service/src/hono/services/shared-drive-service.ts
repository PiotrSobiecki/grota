import { type ConfigAssemblyData, getConfigAssemblyData } from "@repo/data-ops/config";
import { updateOnboardingStep } from "@repo/data-ops/deployment";
import {
	deleteSharedDrivesByDeployment,
	getSharedDrivesByDeployment,
	type SharedDrive,
	type SharedDriveUpsertInput,
	upsertSharedDrives,
} from "@repo/data-ops/shared-drive";
import type { Result } from "../types/result";
import { createSharedDrivesBulk, grantDrivePermissionsBulk } from "./google-drive-api-service";
import { getValidWorkspaceAccessToken } from "./google-token-service";

export async function listSharedDrives(
	deploymentId: string,
): Promise<Result<{ data: SharedDrive[] }>> {
	const data = await getSharedDrivesByDeployment(deploymentId);
	return { ok: true, data: { data } };
}

export async function saveSharedDrives(
	deploymentId: string,
	drives: SharedDriveUpsertInput[],
): Promise<Result<SharedDrive[]>> {
	const result = await upsertSharedDrives(deploymentId, drives);
	await updateOnboardingStep(deploymentId, 4);
	return { ok: true, data: result };
}

export async function removeSharedDrives(deploymentId: string): Promise<Result<{ deleted: true }>> {
	await deleteSharedDrivesByDeployment(deploymentId);
	return { ok: true, data: { deleted: true } };
}

interface CreateAndSaveResult {
	created: SharedDrive[];
	failures: Array<{ name: string; error: string }>;
}

export async function createAndSaveSharedDrives(
	deploymentId: string,
	drives: Array<{ name: string; category: "dokumenty" | "projekty" | "media" }>,
	env: Env,
): Promise<Result<CreateAndSaveResult>> {
	const existing = await getSharedDrivesByDeployment(deploymentId);
	const existingByCategory = new Map(existing.map((d) => [d.category, d]));

	// Split: categories already created in Google vs need creation
	const toCreate: typeof drives = [];
	const alreadyCreated: SharedDriveUpsertInput[] = [];

	for (const drive of drives) {
		const ex = existingByCategory.get(drive.category);
		if (ex?.googleDriveId) {
			alreadyCreated.push({
				name: drive.name,
				category: drive.category,
				googleDriveId: ex.googleDriveId,
			});
		} else {
			toCreate.push(drive);
		}
	}

	const failures: Array<{ name: string; error: string }> = [];
	const newlyCreated: SharedDriveUpsertInput[] = [];

	if (toCreate.length > 0) {
		const tokenResult = await getValidWorkspaceAccessToken(deploymentId, env);
		if (!tokenResult.ok) return tokenResult;

		const bulkResult = await createSharedDrivesBulk(tokenResult.data, toCreate);
		if (!bulkResult.ok) return bulkResult;

		for (const drive of toCreate) {
			const match = bulkResult.data.created.find((c) => c.name === drive.name);
			if (match) {
				newlyCreated.push({
					name: drive.name,
					category: drive.category,
					googleDriveId: match.id,
				});
			}
		}
		failures.push(...bulkResult.data.failures);
	}

	const allDrives = [...alreadyCreated, ...newlyCreated];
	let savedDrives: SharedDrive[] = [];
	if (allDrives.length > 0) {
		savedDrives = await upsertSharedDrives(deploymentId, allDrives);
	}

	await updateOnboardingStep(deploymentId, 4);
	return { ok: true, data: { created: savedDrives, failures } };
}

const MIGRATED_CATEGORIES = new Set(["dokumenty", "projekty"]);

interface PermissionGrant {
	driveId: string;
	email: string;
}

function buildPermissionGrants(data: ConfigAssemblyData): PermissionGrant[] {
	const categoryToDriveId = new Map<string, string>();
	for (const sd of data.sharedDrives) {
		if (sd.googleDriveId) {
			categoryToDriveId.set(sd.category, sd.googleDriveId);
		}
	}

	const seen = new Set<string>();
	const grants: PermissionGrant[] = [];

	for (const account of data.accounts) {
		const categories = new Set(
			account.folders.filter((f) => MIGRATED_CATEGORIES.has(f.category)).map((f) => f.category),
		);

		for (const category of categories) {
			const driveId = categoryToDriveId.get(category);
			if (!driveId) continue;
			const key = `${driveId}:${account.email}`;
			if (seen.has(key)) continue;
			seen.add(key);
			grants.push({ driveId, email: account.email });
		}
	}

	return grants;
}

interface GrantAccessResult {
	granted: number;
	skipped: number;
	failed: number;
	total: number;
	failures: Array<{ driveId: string; email: string; error: string }>;
}

export async function grantAccessToMigratedDrives(
	deploymentId: string,
	env: Env,
): Promise<Result<GrantAccessResult>> {
	const data = await getConfigAssemblyData(deploymentId);
	if (!data) {
		return {
			ok: false,
			error: { code: "DEPLOYMENT_NOT_FOUND", message: "Deployment not found", status: 404 },
		};
	}

	const grants = buildPermissionGrants(data);
	if (grants.length === 0) {
		return { ok: true, data: { granted: 0, skipped: 0, failed: 0, total: 0, failures: [] } };
	}

	const tokenResult = await getValidWorkspaceAccessToken(deploymentId, env);
	if (!tokenResult.ok) return tokenResult;

	const bulkResult = await grantDrivePermissionsBulk(tokenResult.data, grants);
	if (!bulkResult.ok) return bulkResult;

	const { granted, skipped, failures } = bulkResult.data;
	return {
		ok: true,
		data: { granted, skipped, failed: failures.length, total: grants.length, failures },
	};
}
