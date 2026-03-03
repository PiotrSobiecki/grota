import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { Deployment } from "../deployment/schema";
import { deployments } from "../deployment/table";
import { auth_user } from "../drizzle/auth-schema";

export async function updateAdminMagicLink(
	deploymentId: string,
	token: string,
	expiresAt: Date,
): Promise<Deployment | null> {
	const db = getDb();
	const result = await db
		.update(deployments)
		.set({
			adminMagicLinkToken: token,
			adminMagicLinkExpiresAt: expiresAt,
		})
		.where(eq(deployments.id, deploymentId))
		.returning();
	return result[0] ?? null;
}

interface DeploymentWithOperator extends Deployment {
	operatorEmail: string;
}

export async function getDeploymentByAdminToken(
	token: string,
): Promise<DeploymentWithOperator | null> {
	const db = getDb();
	const result = await db
		.select({
			deployment: deployments,
			operatorEmail: auth_user.email,
		})
		.from(deployments)
		.innerJoin(auth_user, eq(deployments.createdBy, auth_user.id))
		.where(eq(deployments.adminMagicLinkToken, token));
	const row = result[0];
	if (!row) return null;
	return { ...row.deployment, operatorEmail: row.operatorEmail };
}
