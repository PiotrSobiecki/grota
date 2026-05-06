import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/database/setup";

describe("integration setup smoke", () => {
	it("can execute a trivial query through the initialized db", async () => {
		const db = getDb();
		const result = (await db.execute(sql`SELECT 1 AS value`)) as unknown as {
			rows: { value: number }[];
		};
		const rows = result.rows ?? (result as unknown as { value: number }[]);
		const first = Array.isArray(rows) ? rows[0] : (rows as { value: number });
		expect(first?.value).toBe(1);
	});
});
