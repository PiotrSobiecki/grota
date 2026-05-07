import { beforeEach, describe, expect, it } from "vitest";
import {
	createTestDeployment,
	createTestUser,
	resetTestDatabase,
} from "@/test/fixtures";
import { getServerConfigAuditLog, recordServerConfigChange } from "./queries";

describe("server-config audit log (integration)", () => {
	beforeEach(async () => {
		await resetTestDatabase();
	});

	it("persists a change and returns it via getServerConfigAuditLog", async () => {
		const deployment = await createTestDeployment();
		const user = await createTestUser();

		const entry = await recordServerConfigChange({
			deploymentId: deployment.id,
			userId: user.id,
			changedFields: ["runner_url", "runner_token"],
		});

		expect(entry.deploymentId).toBe(deployment.id);
		expect(entry.userId).toBe(user.id);
		expect(entry.changedFields).toEqual(["runner_url", "runner_token"]);

		const history = await getServerConfigAuditLog(deployment.id);
		expect(history).toHaveLength(1);
		expect(history[0]?.id).toBe(entry.id);
	});

	it("returns entries newest-first, isolated per deployment", async () => {
		const depA = await createTestDeployment();
		const depB = await createTestDeployment();
		const user = await createTestUser();

		const a1 = await recordServerConfigChange({
			deploymentId: depA.id,
			userId: user.id,
			changedFields: ["runner_url"],
		});
		await new Promise((r) => setTimeout(r, 10));
		const a2 = await recordServerConfigChange({
			deploymentId: depA.id,
			userId: user.id,
			changedFields: ["bwlimit"],
		});
		await recordServerConfigChange({
			deploymentId: depB.id,
			userId: user.id,
			changedFields: ["runner_token"],
		});

		const historyA = await getServerConfigAuditLog(depA.id);
		expect(historyA.map((e) => e.id)).toEqual([a2.id, a1.id]);
	});
});
