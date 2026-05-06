import { spawn } from "node:child_process";
import type { LogLine } from "@repo/data-ops/migration";

export interface SpawnJobOptions {
	command: string;
	args: string[];
	env?: Record<string, string>;
	onLog: (line: LogLine) => void;
}

export interface SpawnJobResult {
	exitCode: number;
}

export function spawnJob(opts: SpawnJobOptions): Promise<SpawnJobResult> {
	return new Promise((resolve) => {
		const child = spawn(opts.command, opts.args, {
			env: opts.env ? { ...process.env, ...opts.env } : process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const buffers: Record<"stdout" | "stderr", string> = {
			stdout: "",
			stderr: "",
		};

		function flushPartial(stream: "stdout" | "stderr") {
			const remainder = buffers[stream];
			if (remainder.length === 0) return;
			opts.onLog({
				ts: new Date().toISOString(),
				stream,
				line: remainder,
			});
			buffers[stream] = "";
		}

		function consume(stream: "stdout" | "stderr", chunk: Buffer) {
			buffers[stream] += chunk.toString("utf8");
			let idx: number;
			// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic line splitter
			while ((idx = buffers[stream].indexOf("\n")) !== -1) {
				const line = buffers[stream].slice(0, idx).replace(/\r$/, "");
				buffers[stream] = buffers[stream].slice(idx + 1);
				opts.onLog({
					ts: new Date().toISOString(),
					stream,
					line,
				});
			}
		}

		child.stdout?.on("data", (c: Buffer) => consume("stdout", c));
		child.stderr?.on("data", (c: Buffer) => consume("stderr", c));

		child.on("error", () => {
			flushPartial("stdout");
			flushPartial("stderr");
			resolve({ exitCode: 1 });
		});

		child.on("close", (code) => {
			flushPartial("stdout");
			flushPartial("stderr");
			resolve({ exitCode: code ?? 1 });
		});
	});
}
