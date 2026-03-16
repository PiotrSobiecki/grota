import { updateDeploymentStatus } from "@repo/data-ops/deployment";
import {
	getDriveOAuthToken,
	getEmployeeById,
	getEmployeesByDeployment,
	updateEmployeeSelectionStatus,
} from "@repo/data-ops/employee";
import { decrypt } from "@repo/data-ops/encryption";
import type {
	DriveItem,
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
// Internals
// ============================================

interface GoogleDriveFile {
	id: string;
	name: string;
	mimeType: string;
	size?: string;
}

interface GoogleDriveListResponse {
	files: GoogleDriveFile[];
	nextPageToken?: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

function deriveItemType(mimeType: string): "folder" | "file" {
	return mimeType === FOLDER_MIME ? "folder" : "file";
}

function parseSize(file: GoogleDriveFile): number | null {
	if (file.size) {
		const n = Number(file.size);
		return Number.isNaN(n) ? null : n;
	}
	return null;
}

function sortItems(items: DriveItem[]): DriveItem[] {
	return items.sort((a, b) => {
		if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

async function resolveAccessToken(employeeId: string, env: Env): Promise<Result<string>> {
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

	let accessToken = tokenPayload.access_token;
	if (Date.now() > tokenPayload.expiry_date && tokenPayload.refresh_token) {
		const refreshResult = await refreshAccessToken(tokenPayload.refresh_token, env);
		if (!refreshResult.ok) return refreshResult;
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

	return { ok: true, data: accessToken };
}

// ============================================
// Service functions
// ============================================

export async function listDriveItems(
	employeeId: string,
	parentId: string,
	pageToken: string | undefined,
	env: Env,
): Promise<Result<{ items: DriveItem[]; nextPageToken: string | null }>> {
	const employee = await getEmployeeById(employeeId);
	if (!employee) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Pracownik nie znaleziony", status: 404 },
		};
	}

	const tokenResult = await resolveAccessToken(employeeId, env);
	if (!tokenResult.ok) return tokenResult;

	const params = new URLSearchParams({
		q: `'${parentId}' in parents and trashed = false`,
		fields: "files(id,name,mimeType,size),nextPageToken",
		pageSize: "200",
		orderBy: "name",
	});
	if (pageToken) {
		params.set("pageToken", pageToken);
	}

	const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
		headers: { Authorization: `Bearer ${tokenResult.data}` },
	});

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
			error: { code: "DRIVE_API_ERROR", message: "Blad API Google Drive", status: 502 },
		};
	}

	const driveData = (await driveResponse.json()) as GoogleDriveListResponse;

	const items: DriveItem[] = driveData.files.map((file) => ({
		id: file.id,
		name: file.name,
		mimeType: file.mimeType,
		type: deriveItemType(file.mimeType),
		size: parseSize(file),
	}));

	// Update employee status to in_progress on first browse
	if (employee.selectionStatus === "pending") {
		await updateEmployeeSelectionStatus(employeeId, "in_progress");
	}

	return {
		ok: true,
		data: { items: sortItems(items), nextPageToken: driveData.nextPageToken ?? null },
	};
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

	if (selections.length > 0) {
		const created = await createFolderSelections(employeeId, selections);
		await updateEmployeeSelectionStatus(employeeId, "completed");
		await checkDeploymentCompletion(employee.deploymentId);
		return { ok: true, data: created };
	}

	await updateEmployeeSelectionStatus(employeeId, "completed");
	await checkDeploymentCompletion(employee.deploymentId);
	return { ok: true, data: [] };
}

async function checkDeploymentCompletion(deploymentId: string): Promise<void> {
	const allEmployees = await getEmployeesByDeployment(deploymentId);
	const allCompleted = allEmployees.every((emp) => emp.selectionStatus === "completed");

	if (allCompleted && allEmployees.length > 0) {
		await updateDeploymentStatus(deploymentId, "ready");
	}
}
