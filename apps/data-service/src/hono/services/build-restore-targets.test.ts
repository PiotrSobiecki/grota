import type { ScheduledCycleRestoreTarget } from "@repo/data-ops/migration";
import { describe, expect, it } from "vitest";
import { buildRestoreTargets } from "./build-restore-targets";

describe("buildRestoreTargets", () => {
	it("returns one target with account-as-folder for a single employee", () => {
		const targets: ScheduledCycleRestoreTarget[] = buildRestoreTargets([
			{ account: "a@example.com" },
		]);
		expect(targets).toEqual([{ account: "a@example.com", targetFolder: "a@example.com" }]);
	});

	it("preserves order across N employees", () => {
		const targets = buildRestoreTargets([
			{ account: "a@example.com" },
			{ account: "b@example.com" },
			{ account: "c@example.com" },
		]);
		expect(targets.map((t) => t.account)).toEqual([
			"a@example.com",
			"b@example.com",
			"c@example.com",
		]);
		for (const t of targets) {
			expect(t.targetFolder).toBe(t.account);
		}
	});
});
