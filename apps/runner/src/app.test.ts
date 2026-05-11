import type {
	B2VerifyRequest,
	B2VerifyResponse,
	LogLine,
} from "@repo/data-ops/migration";
import { describe, expect, it, vi } from "vitest";
import {
	createApp,
	type LogEmitter,
	type RunBackupFn,
	type RunMigrateFn,
} from "./app";

describe("runner app", () => {
	const TOKEN = "test-token-123";
	const app = createApp({ token: TOKEN, version: "0.1.0" });

	function authedJsonRequest(path: string, body: unknown) {
		return app.request(path, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${TOKEN}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});
	}

	describe("GET /health", () => {
		it("returns 200 with status and version when bearer token is valid", async () => {
			const res = await app.request("/health", {
				headers: { Authorization: `Bearer ${TOKEN}` },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ status: "ok", version: "0.1.0" });
		});

		it("returns 401 when Authorization header is missing", async () => {
			const res = await app.request("/health");
			expect(res.status).toBe(401);
		});

		it("returns 401 when bearer token does not match", async () => {
			const res = await app.request("/health", {
				headers: { Authorization: "Bearer wrong-token" },
			});
			expect(res.status).toBe(401);
		});
	});

	describe("POST /verify", () => {
		const validBody: B2VerifyRequest = {
			b2KeyId: "K001abc",
			b2AppKey: "secret-key",
			bucketPrefix: "client-x",
		};

		it("returns ok=true with verifyB2 happy path and forwards request", async () => {
			const verifyB2 = vi.fn(
				async (): Promise<B2VerifyResponse> => ({ ok: true }),
			);
			const verifyApp = createApp({
				token: TOKEN,
				version: "0.1.0",
				verifyB2,
			});

			const res = await verifyApp.request("/verify", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(validBody),
			});

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ ok: true });
			expect(verifyB2).toHaveBeenCalledWith(validBody);
		});

		it("returns ok=false with error message when verifyB2 reports failure", async () => {
			const verifyB2 = vi.fn(
				async (): Promise<B2VerifyResponse> => ({
					ok: false,
					error: "rclone: invalid credentials",
				}),
			);
			const verifyApp = createApp({
				token: TOKEN,
				version: "0.1.0",
				verifyB2,
			});

			const res = await verifyApp.request("/verify", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(validBody),
			});

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				ok: false,
				error: "rclone: invalid credentials",
			});
		});

		it("returns 400 when required body fields are missing", async () => {
			const res = await authedJsonRequest("/verify", { b2KeyId: "K001abc" });
			expect(res.status).toBe(400);
		});

		it("returns 401 when bearer token is missing", async () => {
			const res = await app.request("/verify", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(validBody),
			});
			expect(res.status).toBe(401);
		});
	});

	describe("POST /jobs/backup + GET /jobs/:id", () => {
		it("creates a backup job and returns its jobId; GET /jobs/:id returns running state", async () => {
			const runBackup = vi.fn(() => new Promise<number>(() => {}));
			const jobApp = createApp({
				token: TOKEN,
				version: "0.1.0",
				runBackup,
			});

			const createRes = await jobApp.request("/jobs/backup", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ account: "user@example.com" }),
			});

			expect(createRes.status).toBe(202);
			const created = (await createRes.json()) as { jobId: string };
			expect(created.jobId).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
			);
			expect(runBackup).toHaveBeenCalledTimes(1);
			expect(runBackup).toHaveBeenCalledWith(
				created.jobId,
				{ account: "user@example.com" },
				expect.any(Function),
			);

			const getRes = await jobApp.request(`/jobs/${created.jobId}`, {
				headers: { Authorization: `Bearer ${TOKEN}` },
			});
			expect(getRes.status).toBe(200);
			const job = (await getRes.json()) as {
				id: string;
				status: string;
				exitCode: number | null;
				startedAt: string;
				finishedAt: string | null;
			};
			expect(job.id).toBe(created.jobId);
			expect(job.status).toBe("running");
			expect(job.exitCode).toBeNull();
			expect(job.finishedAt).toBeNull();
			expect(typeof job.startedAt).toBe("string");
		});

		it("GET /jobs/:id returns 404 for unknown job", async () => {
			const res = await app.request(
				"/jobs/00000000-0000-4000-8000-000000000000",
				{ headers: { Authorization: `Bearer ${TOKEN}` } },
			);
			expect(res.status).toBe(404);
		});

		it("marks job as done with exitCode=0 and finishedAt when runBackup resolves with 0", async () => {
			let resolveBackup!: (code: number) => void;
			const runBackup: RunBackupFn = () =>
				new Promise<number>((r) => {
					resolveBackup = r;
				});
			const jobApp = createApp({
				token: TOKEN,
				version: "0.1.0",
				runBackup,
			});

			const createRes = await jobApp.request("/jobs/backup", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: "{}",
			});
			const { jobId } = (await createRes.json()) as { jobId: string };

			resolveBackup(0);
			await vi.waitFor(async () => {
				const r = await jobApp.request(`/jobs/${jobId}`, {
					headers: { Authorization: `Bearer ${TOKEN}` },
				});
				const j = (await r.json()) as { status: string };
				expect(j.status).toBe("done");
			});

			const finalRes = await jobApp.request(`/jobs/${jobId}`, {
				headers: { Authorization: `Bearer ${TOKEN}` },
			});
			const final = (await finalRes.json()) as {
				status: string;
				exitCode: number | null;
				finishedAt: string | null;
			};
			expect(final.exitCode).toBe(0);
			expect(final.finishedAt).not.toBeNull();
		});

		it("marks job as failed when runBackup resolves with non-zero exit code", async () => {
			const runBackup: RunBackupFn = async () => 3;
			const jobApp = createApp({
				token: TOKEN,
				version: "0.1.0",
				runBackup,
			});

			const createRes = await jobApp.request("/jobs/backup", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: "{}",
			});
			const { jobId } = (await createRes.json()) as { jobId: string };

			await vi.waitFor(async () => {
				const r = await jobApp.request(`/jobs/${jobId}`, {
					headers: { Authorization: `Bearer ${TOKEN}` },
				});
				const j = (await r.json()) as {
					status: string;
					exitCode: number | null;
				};
				expect(j.status).toBe("failed");
				expect(j.exitCode).toBe(3);
			});
		});

		it("allows starting a migrate job while a backup is running (per-type concurrency)", async () => {
			const runBackup: RunBackupFn = () => new Promise<number>(() => {});
			const runMigrate: RunMigrateFn = () => new Promise<number>(() => {});
			const jobApp = createApp({
				token: TOKEN,
				version: "0.1.0",
				runBackup,
				runMigrate,
			});

			const backupRes = await jobApp.request("/jobs/backup", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: "{}",
			});
			expect(backupRes.status).toBe(202);

			const migrateRes = await jobApp.request("/jobs/migrate", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: "{}",
			});
			expect(migrateRes.status).toBe(202);
		});

		it("returns 409 when a backup job is already running", async () => {
			const runBackup: RunBackupFn = () => new Promise<number>(() => {});
			const jobApp = createApp({
				token: TOKEN,
				version: "0.1.0",
				runBackup,
			});

			const first = await jobApp.request("/jobs/backup", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: "{}",
			});
			expect(first.status).toBe(202);

			const second = await jobApp.request("/jobs/backup", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: "{}",
			});
			expect(second.status).toBe(409);
		});
	});

	describe("GET /jobs/:id/logs", () => {
		it("returns lines emitted by runBackup via the provided emitLog callback", async () => {
			let emit!: LogEmitter;
			const runBackup: RunBackupFn = async (_jobId, _body, emitLog) => {
				emit = emitLog;
				return new Promise<number>(() => {});
			};
			const jobApp = createApp({ token: TOKEN, version: "0.1.0", runBackup });

			const createRes = await jobApp.request("/jobs/backup", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: "{}",
			});
			const { jobId } = (await createRes.json()) as { jobId: string };

			emit({ ts: "2026-05-06T07:00:00.000Z", stream: "stdout", line: "first" });
			emit({ ts: "2026-05-06T07:00:01.000Z", stream: "stderr", line: "warn" });

			const logsRes = await jobApp.request(`/jobs/${jobId}/logs`, {
				headers: { Authorization: `Bearer ${TOKEN}` },
			});
			expect(logsRes.status).toBe(200);
			const body = (await logsRes.json()) as { lines: LogLine[] };
			expect(body.lines).toEqual([
				{ ts: "2026-05-06T07:00:00.000Z", stream: "stdout", line: "first" },
				{ ts: "2026-05-06T07:00:01.000Z", stream: "stderr", line: "warn" },
			]);
		});

		it("returns 404 for unknown job id", async () => {
			const res = await app.request(
				"/jobs/00000000-0000-4000-8000-000000000000/logs",
				{ headers: { Authorization: `Bearer ${TOKEN}` } },
			);
			expect(res.status).toBe(404);
		});

		it("sanitizes secret-shaped strings before storing in the buffer", async () => {
			let emit!: LogEmitter;
			const runBackup: RunBackupFn = async (_jobId, _body, emitLog) => {
				emit = emitLog;
				return new Promise<number>(() => {});
			};
			const jobApp = createApp({ token: TOKEN, version: "0.1.0", runBackup });
			const createRes = await jobApp.request("/jobs/backup", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: "{}",
			});
			const { jobId } = (await createRes.json()) as { jobId: string };

			emit({
				ts: "2026-05-06T07:00:00.000Z",
				stream: "stderr",
				line: "DEBUG account = K001abc, key = supersecret-app-key",
			});

			const logsRes = await jobApp.request(`/jobs/${jobId}/logs`, {
				headers: { Authorization: `Bearer ${TOKEN}` },
			});
			const body = (await logsRes.json()) as { lines: LogLine[] };
			const stored = body.lines[0]?.line ?? "";
			expect(stored).not.toContain("K001abc");
			expect(stored).not.toContain("supersecret-app-key");
		});
	});

	describe("GET /jobs/:id/logs/stream (SSE)", () => {
		it("streams replayed buffered lines plus live emits, then closes when job finishes", async () => {
			let emit!: LogEmitter;
			let resolveBackup!: (code: number) => void;
			const runBackup: RunBackupFn = async (_jobId, _body, emitLog) => {
				emit = emitLog;
				return new Promise<number>((r) => {
					resolveBackup = r;
				});
			};
			const jobApp = createApp({ token: TOKEN, version: "0.1.0", runBackup });

			const createRes = await jobApp.request("/jobs/backup", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: "{}",
			});
			const { jobId } = (await createRes.json()) as { jobId: string };

			emit({ ts: "2026-05-06T07:00:00.000Z", stream: "stdout", line: "buf-1" });
			emit({ ts: "2026-05-06T07:00:01.000Z", stream: "stdout", line: "buf-2" });

			const streamRes = await jobApp.request(`/jobs/${jobId}/logs/stream`, {
				headers: { Authorization: `Bearer ${TOKEN}` },
			});
			expect(streamRes.status).toBe(200);
			expect(streamRes.headers.get("content-type")).toContain(
				"text/event-stream",
			);

			const collect = (async () => {
				const reader = streamRes.body!.getReader();
				const decoder = new TextDecoder();
				let acc = "";
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					acc += decoder.decode(value, { stream: true });
				}
				return acc;
			})();

			await new Promise((r) => setTimeout(r, 30));
			emit({ ts: "2026-05-06T07:00:02.000Z", stream: "stderr", line: "live" });
			await new Promise((r) => setTimeout(r, 30));
			resolveBackup(0);

			const text = await collect;
			expect(text).toContain('"line":"buf-1"');
			expect(text).toContain('"line":"buf-2"');
			expect(text).toContain('"line":"live"');
		});

		it("returns 404 for unknown job id", async () => {
			const res = await app.request(
				"/jobs/00000000-0000-4000-8000-000000000000/logs/stream",
				{ headers: { Authorization: `Bearer ${TOKEN}` } },
			);
			expect(res.status).toBe(404);
		});
	});

	describe("POST /jobs/migrate", () => {
		it("creates a migrate job, forwards body (with default dryRun=false), and tracks state", async () => {
			const runMigrate = vi.fn(() => new Promise<number>(() => {}));
			const jobApp = createApp({
				token: TOKEN,
				version: "0.1.0",
				runMigrate,
			});

			const createRes = await jobApp.request("/jobs/migrate", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ account: "user@example.com" }),
			});
			expect(createRes.status).toBe(202);
			const { jobId } = (await createRes.json()) as { jobId: string };

			expect(runMigrate).toHaveBeenCalledWith(
				jobId,
				{ account: "user@example.com", dryRun: false },
				expect.any(Function),
			);

			const getRes = await jobApp.request(`/jobs/${jobId}`, {
				headers: { Authorization: `Bearer ${TOKEN}` },
			});
			const job = (await getRes.json()) as { id: string; status: string };
			expect(job.id).toBe(jobId);
			expect(job.status).toBe("running");
		});

		it("forwards dryRun=true when provided", async () => {
			const runMigrate = vi.fn(() => new Promise<number>(() => {}));
			const jobApp = createApp({
				token: TOKEN,
				version: "0.1.0",
				runMigrate,
			});

			await jobApp.request("/jobs/migrate", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ dryRun: true }),
			});

			expect(runMigrate).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ dryRun: true }),
				expect.any(Function),
			);
		});

		it("returns 409 when a migrate job is already running", async () => {
			const runMigrate: RunMigrateFn = () => new Promise<number>(() => {});
			const jobApp = createApp({
				token: TOKEN,
				version: "0.1.0",
				runMigrate,
			});

			const first = await jobApp.request("/jobs/migrate", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: "{}",
			});
			expect(first.status).toBe(202);

			const second = await jobApp.request("/jobs/migrate", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: "{}",
			});
			expect(second.status).toBe(409);
		});
	});

	describe("POST /jobs/ingest", () => {
		const validIngestBody = {
			account: "user@example.com",
			runnerConfig: {
				b2KeyId: "K001abc",
				b2AppKey: "secret",
				bucketPrefix: "client-x",
				backupPath: "/srv/backup/gdrive",
			},
			gdrive: {
				clientId: "g-id",
				clientSecret: "g-secret",
				accessToken: "ya29.x",
				refreshToken: "1//y",
				expiry: "2026-05-11T12:00:00.000Z",
			},
			folders: [
				{
					itemId: "f1",
					itemName: "A",
					itemType: "folder",
					parentFolderId: null,
					sharedDriveName: "Klient-X",
					mimeType: null,
				},
			],
		};

		it("creates an ingest job and returns 202 with jobId; forwards body to runIngest", async () => {
			const runIngest = vi.fn(() => new Promise<number>(() => {}));
			const jobApp = createApp({ token: TOKEN, version: "0.1.0", runIngest });
			const res = await jobApp.request("/jobs/ingest", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(validIngestBody),
			});
			expect(res.status).toBe(202);
			const { jobId } = (await res.json()) as { jobId: string };
			expect(jobId).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
			);
			expect(runIngest).toHaveBeenCalledWith(
				jobId,
				validIngestBody,
				expect.any(Function),
			);
		});

		it("returns 409 when another ingest job is already running", async () => {
			const runIngest = vi.fn(() => new Promise<number>(() => {}));
			const jobApp = createApp({ token: TOKEN, version: "0.1.0", runIngest });
			const first = await jobApp.request("/jobs/ingest", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(validIngestBody),
			});
			expect(first.status).toBe(202);
			const second = await jobApp.request("/jobs/ingest", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(validIngestBody),
			});
			expect(second.status).toBe(409);
		});

		it("returns 400 when body is missing required fields", async () => {
			const res = await authedJsonRequest("/jobs/ingest", {
				account: "user@example.com",
			});
			expect(res.status).toBe(400);
		});
	});
});
