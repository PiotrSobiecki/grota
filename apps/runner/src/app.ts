import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import {
	type B2VerifyRequest,
	B2VerifyRequestSchema,
	type B2VerifyResponse,
	type BackupRequest,
	BackupRequestSchema,
	type GDriveRestoreRequest,
	GDriveRestoreRequestSchema,
	type IngestRequest,
	IngestRequestSchema,
	type LogLine,
	type MigrateRequest,
	MigrateRequestSchema,
	type RunnerJob,
} from "@repo/data-ops/migration";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { streamSSE } from "hono/streaming";
import type { ZodType } from "zod";
import { RingBuffer } from "./ring-buffer.js";
import { sanitizeLogLine } from "./sanitize-log.js";

export type LogEmitter = (line: LogLine) => void;

export type VerifyB2Fn = (req: B2VerifyRequest) => Promise<B2VerifyResponse>;
export type RunBackupFn = (
	jobId: string,
	req: BackupRequest,
	emitLog: LogEmitter,
) => Promise<number>;
export type RunMigrateFn = (
	jobId: string,
	req: MigrateRequest,
	emitLog: LogEmitter,
) => Promise<number>;
export type RunGDriveRestoreFn = (
	jobId: string,
	req: GDriveRestoreRequest,
	emitLog: LogEmitter,
) => Promise<number>;
export type RunIngestFn = (
	jobId: string,
	req: IngestRequest,
	emitLog: LogEmitter,
) => Promise<number>;

type JobType = "backup" | "migrate" | "gdrive-restore" | "ingest";

interface InternalJob extends RunnerJob {
	type: JobType;
	logs: RingBuffer<LogLine>;
	subscribers: Set<(line: LogLine) => void>;
	finishWaiters: Set<() => void>;
}

const LOG_BUFFER_CAPACITY = 5000;

export interface AppConfig {
	token: string;
	version: string;
	verifyB2?: VerifyB2Fn;
	runBackup?: RunBackupFn;
	runMigrate?: RunMigrateFn;
	runGDriveRestore?: RunGDriveRestoreFn;
	runIngest?: RunIngestFn;
}

const verifyB2NotImplemented: VerifyB2Fn = async () => ({
	ok: false,
	error: "verifyB2 not configured",
});

const runBackupNotImplemented: RunBackupFn = async () => 1;
const runMigrateNotImplemented: RunMigrateFn = async () => 1;
const runGDriveRestoreNotImplemented: RunGDriveRestoreFn = async () => 1;
const runIngestNotImplemented: RunIngestFn = async () => 1;

export function createApp(config: AppConfig): Hono {
	const app = new Hono();
	const verifyB2 = config.verifyB2 ?? verifyB2NotImplemented;
	const runBackup = config.runBackup ?? runBackupNotImplemented;
	const runMigrate = config.runMigrate ?? runMigrateNotImplemented;
	const runGDriveRestore = config.runGDriveRestore ?? runGDriveRestoreNotImplemented;
	const runIngest = config.runIngest ?? runIngestNotImplemented;
	const jobs = new Map<string, InternalJob>();

	function isTypeActive(type: JobType): boolean {
		for (const job of jobs.values()) {
			if (job.type !== type) continue;
			if (job.status === "queued" || job.status === "running") return true;
		}
		return false;
	}

	function createJob<T>(
		type: JobType,
		body: T,
		run: (id: string, body: T, emit: LogEmitter) => Promise<number>,
	): string {
		const jobId = randomUUID();
		const logs = new RingBuffer<LogLine>(LOG_BUFFER_CAPACITY);
		const job: InternalJob = {
			id: jobId,
			type,
			status: "running",
			exitCode: null,
			startedAt: new Date().toISOString(),
			finishedAt: null,
			logs,
			subscribers: new Set(),
			finishWaiters: new Set(),
		};
		jobs.set(jobId, job);

		const emit: LogEmitter = (line) => {
			const current = jobs.get(jobId);
			if (!current) return;
			const safe: LogLine = { ...line, line: sanitizeLogLine(line.line) };
			current.logs.push(safe);
			for (const sub of current.subscribers) sub(safe);
		};

		function finalize(status: "done" | "failed", exitCode: number) {
			const current = jobs.get(jobId);
			if (!current) return;
			const next: InternalJob = {
				...current,
				status,
				exitCode,
				finishedAt: new Date().toISOString(),
			};
			jobs.set(jobId, next);
			for (const w of current.finishWaiters) w();
			current.finishWaiters.clear();
		}

		run(jobId, body, emit).then(
			(exitCode) => finalize(exitCode === 0 ? "done" : "failed", exitCode),
			() => finalize("failed", 1),
		);

		return jobId;
	}

	function jobRoute<T>(
		path: string,
		type: JobType,
		schema: ZodType<T>,
		run: (id: string, body: T, emit: LogEmitter) => Promise<number>,
	) {
		app.post(path, zValidator("json", schema), async (c) => {
			if (isTypeActive(type)) {
				return c.json({ error: "job_already_running" }, 409);
			}
			const body = c.req.valid("json") as T;
			const jobId = createJob(type, body, run);
			return c.json({ jobId }, 202);
		});
	}

	app.use("*", bearerAuth({ token: config.token }));

	app.get("/health", (c) => {
		return c.json({ status: "ok", version: config.version });
	});

	app.post("/verify", zValidator("json", B2VerifyRequestSchema), async (c) => {
		const body = c.req.valid("json");
		const result = await verifyB2(body);
		return c.json(result);
	});

	jobRoute("/jobs/backup", "backup", BackupRequestSchema, runBackup);
	jobRoute("/jobs/migrate", "migrate", MigrateRequestSchema, runMigrate);
	jobRoute("/jobs/gdrive-restore", "gdrive-restore", GDriveRestoreRequestSchema, runGDriveRestore);
	jobRoute("/jobs/ingest", "ingest", IngestRequestSchema, runIngest);

	app.get("/jobs/:id", (c) => {
		const id = c.req.param("id");
		const job = jobs.get(id);
		if (!job) return c.json({ error: "not_found" }, 404);
		const { type: _t, logs: _l, subscribers: _s, finishWaiters: _w, ...publicJob } = job;
		return c.json(publicJob satisfies RunnerJob);
	});

	app.get("/jobs/:id/logs", (c) => {
		const id = c.req.param("id");
		const job = jobs.get(id);
		if (!job) return c.json({ error: "not_found" }, 404);
		return c.json({ lines: job.logs.snapshot() });
	});

	app.get("/jobs/:id/logs/stream", (c) => {
		const id = c.req.param("id");
		const job = jobs.get(id);
		if (!job) return c.json({ error: "not_found" }, 404);

		return streamSSE(c, async (stream) => {
			for (const line of job.logs.snapshot()) {
				await stream.writeSSE({
					event: "log",
					data: JSON.stringify(line),
				});
			}

			if (job.status === "done" || job.status === "failed") {
				return;
			}

			const queue: LogLine[] = [];
			let notify: (() => void) | null = null;
			const sub = (line: LogLine) => {
				queue.push(line);
				notify?.();
			};
			job.subscribers.add(sub);

			const finished = new Promise<void>((resolve) => {
				job.finishWaiters.add(resolve);
			});

			try {
				while (true) {
					if (queue.length > 0) {
						const line = queue.shift();
						if (line) {
							await stream.writeSSE({
								event: "log",
								data: JSON.stringify(line),
							});
						}
						continue;
					}
					const wait = new Promise<void>((resolve) => {
						notify = resolve;
					});
					const done = await Promise.race([
						finished.then(() => "done" as const),
						wait.then(() => "tick" as const),
					]);
					notify = null;
					if (done === "done") {
						while (queue.length > 0) {
							const line = queue.shift();
							if (line) {
								await stream.writeSSE({
									event: "log",
									data: JSON.stringify(line),
								});
							}
						}
						break;
					}
				}
			} finally {
				job.subscribers.delete(sub);
			}
		});
	});

	return app;
}
