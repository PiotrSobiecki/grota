import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import { deployments } from "./table";

export async function setWorkspaceOAuthToken(
	deploymentId: string,
	encryptedToken: string,
): Promise<void> {
	const db = getDb();
	await db
		.update(deployments)
		.set({ workspaceOauthToken: encryptedToken })
		.where(eq(deployments.id, deploymentId));
}

export async function getWorkspaceOAuthToken(deploymentId: string): Promise<string | null> {
	const db = getDb();
	const result = await db
		.select({ workspaceOauthToken: deployments.workspaceOauthToken })
		.from(deployments)
		.where(eq(deployments.id, deploymentId));
	return result[0]?.workspaceOauthToken ?? null;
}
