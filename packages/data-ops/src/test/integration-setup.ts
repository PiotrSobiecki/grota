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

// CRITICAL: dev DB doubles as test DB (sesja 6). Never wipe real user data.
// Strategy: delete only rows created by test fixtures, identified by `test-user-*`
// prefix in auth_user.id. Deployments are deleted by created_by, which cascades to
// employees, migration_jobs, shared_drives, folder_selections. Then test users
// themselves are removed. Real users (any non-prefixed id) and their deployments
// stay untouched.
beforeEach(async () => {
	const db = getDb();
	await db.execute(sql`DELETE FROM deployments WHERE created_by LIKE 'test-user-%'`);
	await db.execute(sql`DELETE FROM auth_user WHERE id LIKE 'test-user-%'`);
});

afterAll(() => {
	// Neon HTTP driver has no persistent connections; nothing to close
});
