import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/database/setup";
import { deployments } from "@/deployment/table";
import { auth_user } from "@/drizzle/auth-schema";

// Removes ONLY rows created by test fixtures (identified by `test-user-*` prefix
// in auth_user.id). Real dev data — your deployments, employees, auth sessions —
// stays intact. Cascade chain: deployments(created_by) → employees, migration_jobs,
// shared_drives → folder_selections. See test/integration-setup.ts for matching guard.
export async function resetTestDatabase(): Promise<void> {
	const db = getDb();
	await db.execute(sql`DELETE FROM deployments WHERE created_by LIKE 'test-user-%'`);
	await db.execute(sql`DELETE FROM auth_user WHERE id LIKE 'test-user-%'`);
}

export async function createTestUser(): Promise<{ id: string }> {
	const db = getDb();
	const id = `test-user-${randomUUID()}`;
	await db.insert(auth_user).values({
		id,
		name: "Test User",
		email: `${id}@example.test`,
	});
	return { id };
}

export async function createTestDeployment(): Promise<{ id: string }> {
	const db = getDb();
	const user = await createTestUser();
	const result = await db
		.insert(deployments)
		.values({
			clientName: "Test Client",
			domain: "test.example.com",
			workspaceDelegateEmail: "delegate@test.example.com",
			createdBy: user.id,
		})
		.returning({ id: deployments.id });
	const row = result[0];
	if (!row) throw new Error("Failed to create test deployment");
	return { id: row.id };
}
