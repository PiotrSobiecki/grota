import type { ScheduledCycleRestoreTarget } from "@repo/data-ops/migration";

export function buildRestoreTargets(
	employees: Array<{ account: string }>,
): ScheduledCycleRestoreTarget[] {
	return employees.map((e) => ({ account: e.account, targetFolder: e.account }));
}
