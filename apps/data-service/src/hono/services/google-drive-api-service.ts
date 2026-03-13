import type { Result } from "../types/result";

interface CreatedDrive {
	id: string;
	name: string;
}

interface DriveCreateFailure {
	name: string;
	error: string;
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
	drives: Array<{ name: string; category: string }>,
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
