import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { getDb, initDatabase } from "@/database/setup";

beforeAll(() => {
	const host = process.env.DATABASE_HOST;
	const username = process.env.DATABASE_USERNAME;
	const password = process.env.DATABASE_PASSWORD;
	if (!host || !username || !password) {
		throw new Error(
			"Integration tests require DATABASE_HOST, DATABASE_USERNAME, DATABASE_PASSWORD",
		);
	}
	initDatabase({ host, username, password });
});

beforeEach(async () => {
	const db = getDb();
	const rows = await db.execute<{ tablename: string }>(
		sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '__drizzle_migrations'`,
	);
	const tableList = (rows as unknown as { rows: { tablename: string }[] }).rows ?? rows;
	const names = (tableList as { tablename: string }[]).map((r) => `"${r.tablename}"`);
	if (names.length === 0) return;
	await db.execute(sql.raw(`TRUNCATE ${names.join(",")} RESTART IDENTITY CASCADE`));
});

afterAll(() => {
	// Neon HTTP driver has no persistent connections; nothing to close
});
