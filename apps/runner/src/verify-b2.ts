import { spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { B2VerifyRequest, B2VerifyResponse } from "@repo/data-ops/migration";

export function buildRcloneConfig(req: B2VerifyRequest): string {
	return [
		"[b2]",
		"type = b2",
		`account = ${req.b2KeyId}`,
		`key = ${req.b2AppKey}`,
		"hard_delete = true",
		"",
	].join("\n");
}

export interface RcloneSpawnResult {
	exitCode: number;
	stderr: string;
}

export type RcloneSpawnFn = (
	command: string,
	args: string[],
	opts: { configContent: string },
) => Promise<RcloneSpawnResult>;

export function createVerifyB2(spawn: RcloneSpawnFn) {
	return async (req: B2VerifyRequest): Promise<B2VerifyResponse> => {
		const configContent = buildRcloneConfig(req);
		const result = await spawn(
			"rclone",
			["--config", "<tmp>", "lsd", "b2:"],
			{ configContent },
		);
		if (result.exitCode === 0) return { ok: true };
		return {
			ok: false,
			error: result.stderr.trim() || `rclone exited with code ${result.exitCode}`,
		};
	};
}

// Real spawn impl: writes configContent to a temp file, runs rclone, captures stderr.
export const realRcloneSpawn: RcloneSpawnFn = async (command, args, opts) => {
	const dir = await mkdtemp(join(tmpdir(), "grota-rclone-"));
	const configPath = join(dir, "rclone.conf");
	await writeFile(configPath, opts.configContent, { mode: 0o600 });
	try {
		const finalArgs = args.map((a) => (a === "<tmp>" ? configPath : a));
		return await new Promise<RcloneSpawnResult>((resolve) => {
			const child = nodeSpawn(command, finalArgs, {
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stderr = "";
			child.stderr?.on("data", (c: Buffer) => {
				stderr += c.toString("utf8");
			});
			child.on("error", () => resolve({ exitCode: 1, stderr }));
			child.on("close", (code) => resolve({ exitCode: code ?? 1, stderr }));
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};
