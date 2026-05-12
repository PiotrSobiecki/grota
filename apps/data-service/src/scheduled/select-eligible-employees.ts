export type Candidate = {
	id: string;
	email: string;
	oauthStatus: "pending" | "authorized" | "failed";
	selectionStatus: "pending" | "in_progress" | "completed";
};

export type SkipReason = "no_oauth" | "no_folders";

export type SelectionResult<T extends Candidate> = {
	eligible: T[];
	skipped: Array<{ email: string; reason: SkipReason }>;
};

export function selectEligibleEmployees<T extends Candidate>(employees: T[]): SelectionResult<T> {
	const eligible: T[] = [];
	const skipped: Array<{ email: string; reason: SkipReason }> = [];
	for (const employee of employees) {
		if (employee.oauthStatus !== "authorized") {
			skipped.push({ email: employee.email, reason: "no_oauth" });
			continue;
		}
		if (employee.selectionStatus !== "completed") {
			skipped.push({ email: employee.email, reason: "no_folders" });
			continue;
		}
		eligible.push(employee);
	}
	return { eligible, skipped };
}
