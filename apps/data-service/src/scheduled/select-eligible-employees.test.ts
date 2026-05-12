import { describe, expect, it } from "vitest";
import { selectEligibleEmployees } from "./select-eligible-employees";

describe("selectEligibleEmployees", () => {
	it("marks all employees as eligible when each has authorized OAuth and completed folder selection", () => {
		const employees = [
			{
				id: "a",
				email: "a@example.com",
				oauthStatus: "authorized" as const,
				selectionStatus: "completed" as const,
			},
			{
				id: "b",
				email: "b@example.com",
				oauthStatus: "authorized" as const,
				selectionStatus: "completed" as const,
			},
		];

		const result = selectEligibleEmployees(employees);

		expect(result.eligible.map((e) => e.email)).toEqual(["a@example.com", "b@example.com"]);
		expect(result.skipped).toEqual([]);
	});

	it("skips employees without authorized OAuth with reason 'no_oauth'", () => {
		const employees = [
			{
				id: "a",
				email: "ready@example.com",
				oauthStatus: "authorized" as const,
				selectionStatus: "completed" as const,
			},
			{
				id: "b",
				email: "pending@example.com",
				oauthStatus: "pending" as const,
				selectionStatus: "completed" as const,
			},
			{
				id: "c",
				email: "failed@example.com",
				oauthStatus: "failed" as const,
				selectionStatus: "completed" as const,
			},
		];

		const result = selectEligibleEmployees(employees);

		expect(result.eligible.map((e) => e.email)).toEqual(["ready@example.com"]);
		expect(result.skipped).toEqual([
			{ email: "pending@example.com", reason: "no_oauth" },
			{ email: "failed@example.com", reason: "no_oauth" },
		]);
	});

	it("skips employees with OAuth but incomplete folder selection with reason 'no_folders'", () => {
		const employees = [
			{
				id: "a",
				email: "ready@example.com",
				oauthStatus: "authorized" as const,
				selectionStatus: "completed" as const,
			},
			{
				id: "b",
				email: "in-progress@example.com",
				oauthStatus: "authorized" as const,
				selectionStatus: "in_progress" as const,
			},
			{
				id: "c",
				email: "pending-folders@example.com",
				oauthStatus: "authorized" as const,
				selectionStatus: "pending" as const,
			},
		];

		const result = selectEligibleEmployees(employees);

		expect(result.eligible.map((e) => e.email)).toEqual(["ready@example.com"]);
		expect(result.skipped).toEqual([
			{ email: "in-progress@example.com", reason: "no_folders" },
			{ email: "pending-folders@example.com", reason: "no_folders" },
		]);
	});
});
