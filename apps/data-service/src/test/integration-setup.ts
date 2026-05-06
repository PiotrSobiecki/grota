import { initDatabase } from "@repo/data-ops/database/setup";
import { resetTestDatabase } from "@repo/data-ops/test-fixtures";
import { beforeAll, beforeEach } from "vitest";

beforeAll(() => {
	const host = process.env.DATABASE_HOST;
	const username = process.env.DATABASE_USERNAME;
	const password = process.env.DATABASE_PASSWORD;
	if (!host || !username || !password) {
		throw new Error(
			"Integration tests require DATABASE_HOST, DATABASE_USERNAME, DATABASE_PASSWORD",
		);
	}
	if (!process.env.ENCRYPTION_KEY) {
		throw new Error("Integration tests require ENCRYPTION_KEY");
	}
	initDatabase({ host, username, password });
});

beforeEach(async () => {
	await resetTestDatabase();
});
