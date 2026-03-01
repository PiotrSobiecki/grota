import {
	createDeployment as createDeploymentQuery,
	type Deployment,
	type DeploymentCreateInput,
	type DeploymentListRequest,
	type DeploymentListResponse,
	getDeployments as getDeploymentsQuery,
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
