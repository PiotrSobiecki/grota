import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import { deployments } from "../deployment/table";
import { employees } from "../employee/table";
import { folderSelections } from "../folder-selection/table";

export interface ConfigAssemblyData {
	deployment: {
		id: string;
		clientName: string;
		domain: string;
		workspaceOauthToken: string | null;
		b2Config: unknown;
		serverConfig: unknown;
		adminEmail: string | null;
		createdAt: Date;
	};
	accounts: Array<{
		id: string;
		email: string;
		name: string;
		driveOauthToken: string | null;
		folders: Array<{
			folderId: string;
			folderName: string;
			category: string;
		}>;
	}>;
}

export async function getConfigAssemblyData(
	deploymentId: string,
): Promise<ConfigAssemblyData | null> {
	const db = getDb();

	const deploymentResult = await db
		.select()
		.from(deployments)
		.where(eq(deployments.id, deploymentId));
	const deployment = deploymentResult[0];
	if (!deployment) return null;

	const employeeList = await db
		.select()
		.from(employees)
		.where(eq(employees.deploymentId, deploymentId));

	const accounts = await Promise.all(
		employeeList.map(async (emp) => {
			const selections = await db
				.select()
				.from(folderSelections)
				.where(eq(folderSelections.employeeId, emp.id));

			return {
				id: emp.id,
				email: emp.email,
				name: emp.name,
				driveOauthToken: emp.driveOauthToken,
				folders: selections.map((s) => ({
					folderId: s.folderId,
					folderName: s.folderName,
					category: s.category,
				})),
			};
		}),
	);

	return {
		deployment: {
			id: deployment.id,
			clientName: deployment.clientName,
			domain: deployment.domain,
			workspaceOauthToken: deployment.workspaceOauthToken,
			b2Config: deployment.b2Config,
			serverConfig: deployment.serverConfig,
			adminEmail: deployment.adminEmail,
			createdAt: deployment.createdAt,
		},
		accounts,
	};
}
