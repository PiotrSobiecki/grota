import type { Result } from "../types/result";

interface CreatedDrive {
	id: string;
	name: string;
}

interface DriveCreateFailure {
	name: string;
	error: string;
}

interface PermissionGrant {
	driveId: string;
	email: string;
}

interface PermissionResult {
	permissionId: string;
	alreadyExisted: boolean;
}

interface BulkPermissionResult {
	granted: number;
	skipped: number;
	failures: Array<{ driveId: string; email: string; error: string }>;
}

export async function createSharedDrive(
	accessToken: string,
	name: string,
): Promise<Result<CreatedDrive>> {
	const requestId = crypto.randomUUID();
	const response = await fetch(
		`https://www.googleapis.com/drive/v3/drives?requestId=${requestId}`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name }),
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		// biome-ignore lint/suspicious/noConsole: Worker logs for Drive API diagnostics
		console.error(`Failed to create Shared Drive "${name}":`, errorText);
		return {
			ok: false,
			error: {
				code: "DRIVE_CREATE_FAILED",
				message: `Nie udalo sie utworzyc dysku "${name}"`,
				status: response.status,
			},
		};
	}

	const data = (await response.json()) as { id: string; name: string };
	return { ok: true, data: { id: data.id, name: data.name } };
}

export async function createSharedDrivesBulk(
	accessToken: string,
	drives: Array<{ name: string }>,
): Promise<Result<{ created: CreatedDrive[]; failures: DriveCreateFailure[] }>> {
	const results = await Promise.allSettled(
		drives.map(async (drive) => {
			const result = await createSharedDrive(accessToken, drive.name);
			return { ...drive, result };
		}),
	);

	const created: CreatedDrive[] = [];
	const failures: DriveCreateFailure[] = [];

	for (const settled of results) {
		if (settled.status === "rejected") {
			failures.push({ name: "unknown", error: String(settled.reason) });
			continue;
		}
		const { name, result } = settled.value;
		if (result.ok) {
			created.push(result.data);
		} else {
			failures.push({ name, error: result.error.message });
		}
	}

	return { ok: true, data: { created, failures } };
}

export async function grantDrivePermission(
	accessToken: string,
	driveId: string,
	email: string,
): Promise<Result<PermissionResult>> {
	const response = await fetch(
		`https://www.googleapis.com/drive/v3/files/${driveId}/permissions?supportsAllDrives=true&sendNotificationEmail=true`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ type: "user", role: "reader", emailAddress: email }),
		},
	);

	if (response.status === 409) {
		return { ok: true, data: { permissionId: "", alreadyExisted: true } };
	}

	if (!response.ok) {
		const errorText = await response.text();
		// biome-ignore lint/suspicious/noConsole: Worker logs for Drive API diagnostics
		console.error(`Failed to grant permission on drive "${driveId}" for ${email}:`, errorText);
		return {
			ok: false,
			error: {
				code: "PERMISSION_GRANT_FAILED",
				message: `Nie udalo sie nadac uprawnien do dysku "${driveId}" dla ${email}`,
				status: response.status,
			},
		};
	}

	const data = (await response.json()) as { id: string };
	return { ok: true, data: { permissionId: data.id, alreadyExisted: false } };
}

const PERMISSION_BATCH_SIZE = 10;

export async function grantDrivePermissionsBulk(
	accessToken: string,
	grants: PermissionGrant[],
): Promise<Result<BulkPermissionResult>> {
	let granted = 0;
	let skipped = 0;
	const failures: BulkPermissionResult["failures"] = [];

	for (let i = 0; i < grants.length; i += PERMISSION_BATCH_SIZE) {
		const batch = grants.slice(i, i + PERMISSION_BATCH_SIZE);
		const results = await Promise.allSettled(
			batch.map(async (grant) => {
				const result = await grantDrivePermission(accessToken, grant.driveId, grant.email);
				return { ...grant, result };
			}),
		);

		for (const settled of results) {
			if (settled.status === "rejected") {
				failures.push({ driveId: "unknown", email: "unknown", error: String(settled.reason) });
				continue;
			}
			const { driveId, email, result } = settled.value;
			if (!result.ok) {
				failures.push({ driveId, email, error: result.error.message });
			} else if (result.data.alreadyExisted) {
				skipped++;
			} else {
				granted++;
			}
		}
	}

	return { ok: true, data: { granted, skipped, failures } };
}
