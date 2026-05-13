import type { ScheduledCycleRestoreTarget } from "@repo/data-ops/migration";

export function buildRestoreTargets(
	employees: Array<{ account: string; includePaths?: string[] }>,
): ScheduledCycleRestoreTarget[] {
	return employees.map((e) => ({
		account: e.account,
		targetFolder: e.account,
		...(e.includePaths && e.includePaths.length > 0 ? { includePaths: e.includePaths } : {}),
	}));
}
