import { describe, expect, it, vi } from "vitest";
import { spawnJob } from "./spawn-job";

const NODE = process.execPath;

describe("spawnJob", () => {
	it("captures stdout lines and resolves with exit code 0 on success", async () => {
		const onLog = vi.fn();
		const result = await spawnJob({
			command: NODE,
			args: ["-e", "console.log('hello'); console.log('world');"],
			onLog,
		});

		expect(result.exitCode).toBe(0);
		const stdoutLines = onLog.mock.calls
			.map(([line]) => line as { stream: string; line: string })
			.filter((l) => l.stream === "stdout")
			.map((l) => l.line);
		expect(stdoutLines).toContain("hello");
		expect(stdoutLines).toContain("world");
	});

	it("captures stderr separately and resolves with non-zero exit code on failure", async () => {
		const onLog = vi.fn();
		const result = await spawnJob({
			command: NODE,
			args: ["-e", "console.error('boom'); process.exit(7);"],
			onLog,
		});

		expect(result.exitCode).toBe(7);
		const stderrLines = onLog.mock.calls
			.map(([line]) => line as { stream: string; line: string })
			.filter((l) => l.stream === "stderr")
			.map((l) => l.line);
		expect(stderrLines).toContain("boom");
	});

	it("forwards env vars to the child process", async () => {
		const onLog = vi.fn();
		const result = await spawnJob({
			command: NODE,
			args: ["-e", "console.log(process.env.MY_TEST_VAR);"],
			env: { MY_TEST_VAR: "from-parent" },
			onLog,
		});

		expect(result.exitCode).toBe(0);
		const stdout = onLog.mock.calls.map(([line]) => line as { line: string }).map((l) => l.line);
		expect(stdout).toContain("from-parent");
	});

	it("emits LogLine objects with ISO timestamp and stream marker", async () => {
		const onLog = vi.fn();
		await spawnJob({
			command: NODE,
			args: ["-e", "console.log('a');"],
			onLog,
		});

		expect(onLog).toHaveBeenCalled();
		const first = onLog.mock.calls[0]?.[0] as {
			ts: string;
			stream: string;
			line: string;
		};
		expect(first.stream).toBe("stdout");
		expect(first.line).toBe("a");
		expect(() => new Date(first.ts).toISOString()).not.toThrow();
	});

	it("rejects with exit code 1 when the command does not exist", async () => {
		const onLog = vi.fn();
		const result = await spawnJob({
			command: "this-command-does-not-exist-xyz-123",
			args: [],
			onLog,
		});
		expect(result.exitCode).not.toBe(0);
	});
});
