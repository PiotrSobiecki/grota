import { recordScheduleChange, type ScheduleAuditAction } from "@repo/data-ops/audit-log";
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
	operatorId: string | null,
): Promise<Result<DeploymentSchedule>> {
	const deployment = await getDeployment(deploymentId);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie zostalo znalezione", status: 404 },
		};
	}
	const previous = await getSchedule(deploymentId);
	const stored = await setSchedule(deploymentId, input);

	if (operatorId) {
		const change = detectScheduleChange(previous, stored);
		if (change) {
			await recordScheduleChange({
				deploymentId,
				userId: operatorId,
				action: change.action,
				diff: change.diff,
			});
		}
	}

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

interface ScheduleChange {
	action: ScheduleAuditAction;
	diff: Record<string, { from: unknown; to: unknown }>;
}

function detectScheduleChange(
	previous: DeploymentSchedule | null,
	next: DeploymentSchedule,
): ScheduleChange | null {
	const previousEnabled = previous?.enabled ?? false;
	const diff: Record<string, { from: unknown; to: unknown }> = {};

	if (previousEnabled !== next.enabled) {
		diff.enabled = { from: previousEnabled, to: next.enabled };
	}
	if ((previous?.intervalHours ?? null) !== next.intervalHours) {
		diff.intervalHours = { from: previous?.intervalHours ?? null, to: next.intervalHours };
	}
	if ((previous?.anchorTime ?? null) !== next.anchorTime) {
		diff.anchorTime = { from: previous?.anchorTime ?? null, to: next.anchorTime };
	}

	if (Object.keys(diff).length === 0) return null;

	let action: ScheduleAuditAction;
	if (previousEnabled !== next.enabled) {
		action = next.enabled ? "schedule.enabled" : "schedule.disabled";
	} else {
		action = "schedule.updated";
	}
	return { action, diff };
}
