import { getDeployment } from "@repo/data-ops/deployment";
import {
	type DeploymentSchedule,
	getSchedule,
	type SetScheduleInput,
	setSchedule,
} from "@repo/data-ops/schedule";
import type { Result } from "../types/result";

export async function setScheduleForDeployment(
	deploymentId: string,
	input: SetScheduleInput,
): Promise<Result<DeploymentSchedule>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie zostalo znalezione", status: 404 },
		};
	}
	const stored = await setSchedule(deploymentId, input);
	return { ok: true, data: stored };
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
