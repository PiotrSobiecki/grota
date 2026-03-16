import { updateDeploymentStatus } from "@repo/data-ops/deployment";
import {
	getDriveOAuthToken,
	getEmployeeById,
	getEmployeesByDeployment,
	updateEmployeeSelectionStatus,
} from "@repo/data-ops/employee";
import { decrypt } from "@repo/data-ops/encryption";
import type {
	DriveFolder,
	FolderSelection,
	FolderSelectionCreateInput,
} from "@repo/data-ops/folder-selection";
import {
	createFolderSelections,
	deleteFolderSelectionsByEmployee,
	getFolderSelectionsByEmployee,
} from "@repo/data-ops/folder-selection";
import type { Result } from "../types/result";
import { refreshAccessToken } from "./google-token-service";

// ============================================
// Service functions
// ============================================

export async function listDriveFolders(
	employeeId: string,
	env: Env,
): Promise<Result<{ folders: DriveFolder[] }>> {
	const employee = await getEmployeeById(employeeId);
	if (!employee) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Pracownik nie znaleziony", status: 404 },
		};
	}

	const encryptedToken = await getDriveOAuthToken(employeeId);
	if (!encryptedToken) {
		return {
			ok: false,
			error: {
				code: "NO_OAUTH_TOKEN",
				message: "Brak autoryzacji Google Drive. Przejdz przez krok 1.",
				status: 401,
			},
		};
	}

	let tokenPayload: { access_token: string; refresh_token: string | null; expiry_date: number };
	try {
		const decrypted = await decrypt(encryptedToken, env.ENCRYPTION_KEY);
		tokenPayload = JSON.parse(decrypted);
	} catch {
		return {
			ok: false,
			error: {
				code: "TOKEN_DECRYPT_FAILED",
				message: "Nie udalo sie odszyfrowac tokenu. Prosimy o ponowna autoryzacje.",
				status: 500,
			},
		};
	}

	// Refresh if expired
	let accessToken = tokenPayload.access_token;
	if (Date.now() > tokenPayload.expiry_date && tokenPayload.refresh_token) {
		const refreshResult = await refreshAccessToken(tokenPayload.refresh_token, env);
		if (!refreshResult.ok) {
			return refreshResult;
		}
		accessToken = refreshResult.data.access_token;

		const { encrypt } = await import("@repo/data-ops/encryption");
		const { setDriveOAuthToken } = await import("@repo/data-ops/employee");
		const updatedPayload = {
			...tokenPayload,
			access_token: accessToken,
			expiry_date: refreshResult.data.expiry_date,
		};
		const encrypted = await encrypt(JSON.stringify(updatedPayload), env.ENCRYPTION_KEY);
		await setDriveOAuthToken(employeeId, encrypted);
	}

	// Fetch top-level folders from Google Drive API
	const driveResponse = await fetch(
		`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({
			q: "'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
			fields: "files(id,name,mimeType)",
			pageSize: "100",
			orderBy: "name",
		})}`,
		{
			headers: { Authorization: `Bearer ${accessToken}` },
		},
	);

	if (!driveResponse.ok) {
		const errorText = await driveResponse.text();
		// biome-ignore lint/suspicious/noConsole: Worker logs for Drive API diagnostics
		console.error("Drive API error:", errorText);

		if (driveResponse.status === 401) {
			return {
				ok: false,
				error: {
					code: "OAUTH_EXPIRED",
					message: "Token Google wygasl. Prosimy o ponowna autoryzacje.",
					status: 401,
				},
			};
		}

		return {
			ok: false,
			error: {
				code: "DRIVE_API_ERROR",
				message: "Blad API Google Drive",
				status: 502,
			},
		};
	}

	const driveData = (await driveResponse.json()) as {
		files: Array<{ id: string; name: string; mimeType: string }>;
	};

	const folders: DriveFolder[] = driveData.files.map((file) => ({
		id: file.id,
		name: file.name,
		mimeType: file.mimeType,
	}));

	// Update employee status to in_progress
	if (employee.selectionStatus === "pending") {
		await updateEmployeeSelectionStatus(employeeId, "in_progress");
	}

	return { ok: true, data: { folders } };
}

export async function getSelections(
	employeeId: string,
): Promise<Result<{ data: FolderSelection[]; total: number }>> {
	const selections = await getFolderSelectionsByEmployee(employeeId);
	return { ok: true, data: { data: selections, total: selections.length } };
}

export async function saveSelections(
	employeeId: string,
	selections: FolderSelectionCreateInput[],
	_env: Env,
): Promise<Result<FolderSelection[]>> {
	const employee = await getEmployeeById(employeeId);
	if (!employee) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Pracownik nie znaleziony", status: 404 },
		};
	}

	await deleteFolderSelectionsByEmployee(employeeId);
	const created = await createFolderSelections(employeeId, selections);

	await updateEmployeeSelectionStatus(employeeId, "completed");
	await checkDeploymentCompletion(employee.deploymentId);

	return { ok: true, data: created };
}

async function checkDeploymentCompletion(deploymentId: string): Promise<void> {
	const allEmployees = await getEmployeesByDeployment(deploymentId);
	const allCompleted = allEmployees.every((emp) => emp.selectionStatus === "completed");

	if (allCompleted && allEmployees.length > 0) {
		await updateDeploymentStatus(deploymentId, "ready");
	}
}
