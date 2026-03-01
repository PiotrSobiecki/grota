import {
	createDeployment as createDeploymentQuery,
	type Deployment,
	type DeploymentCreateInput,
	type DeploymentListRequest,
	type DeploymentListResponse,
	type DeploymentUpdateInput,
	getDeployment,
	getDeployments as getDeploymentsQuery,
	updateDeployment as updateDeploymentQuery,
} from "@repo/data-ops/deployment";
import type { Result } from "../types/result";

export async function getDeployments(
	params: DeploymentListRequest,
	operatorId: string,
): Promise<Result<DeploymentListResponse>> {
	const data = await getDeploymentsQuery(params, operatorId);
	return { ok: true, data };
}

export async function createDeployment(
	data: DeploymentCreateInput,
	operatorId: string,
): Promise<Result<Deployment>> {
	const deployment = await createDeploymentQuery({ ...data, createdBy: operatorId });
	return { ok: true, data: deployment };
}

export async function getDeploymentById(id: string): Promise<Result<Deployment>> {
	const deployment = await getDeployment(id);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie zostalo znalezione", status: 404 },
		};
	}
	return { ok: true, data: deployment };
}

export async function updateDeployment(
	id: string,
	data: DeploymentUpdateInput,
): Promise<Result<Deployment>> {
	const deployment = await updateDeploymentQuery(id, data);
	if (!deployment) {
		return {
			ok: false,
			error: { code: "NOT_FOUND", message: "Wdrozenie nie zostalo znalezione", status: 404 },
		};
	}
	return { ok: true, data: deployment };
}
