import { sql } from "drizzle-orm";
import { initDatabase } from "../setup";

async function seedDb() {
	const db = initDatabase({
		host: process.env.DATABASE_HOST!,
		username: process.env.DATABASE_USERNAME!,
		password: process.env.DATABASE_PASSWORD!,
	});
	await db.execute(sql`SELECT 1`);

	// Seed data will be added by doc 002+ when new tables are introduced.

	process.exit(0);
}

seedDb().catch((_error) => {
	process.exit(1);
});
