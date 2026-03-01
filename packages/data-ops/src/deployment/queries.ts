import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type {
	Deployment,
	DeploymentCreateInput,
	DeploymentListRequest,
	DeploymentListResponse,
	DeploymentStatus,
	DeploymentUpdateInput,
} from "./schema";
import { deployments } from "./table";

export async function getDeployment(deploymentId: string): Promise<Deployment | null> {
	const db = getDb();
	const result = await db.select().from(deployments).where(eq(deployments.id, deploymentId));
	return result[0] ?? null;
}

export async function getDeployments(
	params: DeploymentListRequest,
	operatorId: string,
): Promise<DeploymentListResponse> {
	const db = getDb();
	const conditions = [eq(deployments.createdBy, operatorId)];

	if (params.status) {
		conditions.push(eq(deployments.status, params.status));
	}

	const whereClause = and(...conditions);

	const [data, countResult] = await Promise.all([
		db
			.select()
			.from(deployments)
			.where(whereClause)
			.limit(params.limit)
			.offset(params.offset)
			.orderBy(deployments.createdAt),
		db.select({ total: count() }).from(deployments).where(whereClause),
	]);

	const total = countResult[0]?.total ?? 0;

	return {
		data,
		pagination: {
			total,
			limit: params.limit,
			offset: params.offset,
			hasMore: params.offset + data.length < total,
		},
	};
}

export async function createDeployment(
	data: DeploymentCreateInput & { createdBy: string },
): Promise<Deployment> {
	const db = getDb();
	const [deployment] = await db
		.insert(deployments)
		.values({
			clientName: data.clientName,
			domain: data.domain,
			adminEmail: data.adminEmail ?? null,
			adminName: data.adminName ?? null,
			createdBy: data.createdBy,
		})
		.returning();
	return deployment!;
}

export async function updateDeployment(
	deploymentId: string,
	data: DeploymentUpdateInput,
): Promise<Deployment | null> {
	const db = getDb();
	const result = await db
		.update(deployments)
		.set(data)
		.where(eq(deployments.id, deploymentId))
		.returning();
	return result[0] ?? null;
}

export async function updateDeploymentStatus(
	deploymentId: string,
	status: DeploymentStatus,
): Promise<Deployment | null> {
	const db = getDb();
	const result = await db
		.update(deployments)
		.set({ status })
		.where(eq(deployments.id, deploymentId))
		.returning();
	return result[0] ?? null;
}
