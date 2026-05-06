import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/database/setup";
import { deployments } from "@/deployment/table";
import { auth_user } from "@/drizzle/auth-schema";

export async function resetTestDatabase(): Promise<void> {
	const db = getDb();
	const rows = await db.execute(
		sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '__drizzle_migrations'`,
	);
	const list = (rows as unknown as { rows: { tablename: string }[] }).rows ?? rows;
	const names = (list as { tablename: string }[]).map((r) => `"${r.tablename}"`);
	if (names.length === 0) return;
	await db.execute(sql.raw(`TRUNCATE ${names.join(",")} RESTART IDENTITY CASCADE`));
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
			createdBy: user.id,
		})
		.returning({ id: deployments.id });
	const row = result[0];
	if (!row) throw new Error("Failed to create test deployment");
	return { id: row.id };
}
