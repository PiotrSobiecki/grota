import { getDeployment } from "@repo/data-ops/deployment";
import { type DeploymentSchedule, getSchedule, setScheduleEnabled } from "@repo/data-ops/schedule";
import type { Result } from "../types/result";

export async function setScheduleEnabledForDeployment(
	deploymentId: string,
	enabled: boolean,
): Promise<Result<DeploymentSchedule>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie zostalo znalezione", status: 404 },
		};
	}
	await setScheduleEnabled(deploymentId, enabled);
	const schedule = await getSchedule(deploymentId);
	if (!schedule) {
		return {
			ok: false,
			error: {
				code: "SCHEDULE_PERSIST_FAILED",
				message: "Nie udalo sie zapisac harmonogramu",
				status: 500,
			},
		};
	}
	return { ok: true, data: schedule };
}

export async function getScheduleForDeployment(
	deploymentId: string,
): Promise<Result<DeploymentSchedule | null>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie zostalo znalezione", status: 404 },
		};
	}
	const schedule = await getSchedule(deploymentId);
	return { ok: true, data: schedule };
}
