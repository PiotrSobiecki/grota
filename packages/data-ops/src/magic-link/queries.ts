import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { Deployment } from "../deployment/schema";
import { deployments } from "../deployment/table";

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

export async function getDeploymentByAdminToken(token: string): Promise<Deployment | null> {
	const db = getDb();
	const result = await db
		.select()
		.from(deployments)
		.where(eq(deployments.adminMagicLinkToken, token));
	return result[0] ?? null;
}
