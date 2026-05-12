import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyJobFailed } from "./alert-service";

function envForTest(): Env {
	return {
		TELEGRAM_BOT_TOKEN: "test-bot-token",
		TELEGRAM_CHAT_ID: "-100test",
		RESEND_API_KEY: "re_test",
		OPERATOR_ALERT_EMAIL: "ops@example.com",
		PUBLIC_APP_URL: "https://app.example.com",
	} as unknown as Env;
}

interface CapturedRequest {
	url: string;
	body: unknown;
}

function captureFetch(): {
	spy: ReturnType<typeof vi.spyOn>;
	requests: CapturedRequest[];
} {
	const requests: CapturedRequest[] = [];
	const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = String(input);
		const bodyText = typeof init?.body === "string" ? init.body : "";
		let body: unknown = bodyText;
		try {
			body = JSON.parse(bodyText);
		} catch {
			// keep as text
		}
		requests.push({ url, body });
		return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
	});
	return { spy, requests };
}

describe("notifyJobFailed", () => {
	let captured: ReturnType<typeof captureFetch>;

	beforeEach(() => {
		captured = captureFetch();
	});
	afterEach(() => {
		captured.spy.mockRestore();
	});

	it("sends both Telegram and email with deployment name, jobId, exit code and link", async () => {
		const result = await notifyJobFailed(
			{
				deploymentId: "11111111-1111-4111-8111-111111111111",
				jobId: "22222222-2222-4222-8222-222222222222",
				reason: "job_failed",
				clientName: "ClientX",
				exitCode: 137,
				logTail: "line1\nline2\nline3",
			},
			envForTest(),
		);

		expect(result.telegram).toBe("ok");
		expect(result.email).toBe("ok");

		const tg = captured.requests.find((r) => r.url.includes("api.telegram.org"));
		expect(tg).toBeDefined();
		const tgBody = tg?.body as { chat_id: string; text: string };
		expect(tgBody.text).toContain("ClientX");
		expect(tgBody.text).toContain("22222222-2222-4222-8222-222222222222");
		expect(tgBody.text).toContain("137");
		expect(tgBody.text).toContain(
			"https://app.example.com/dashboard/11111111-1111-4111-8111-111111111111/migration",
		);

		const mail = captured.requests.find((r) => r.url.includes("api.resend.com"));
		expect(mail).toBeDefined();
		const mailBody = mail?.body as { to: string[]; html: string; text: string; subject: string };
		expect(mailBody.to).toEqual(["ops@example.com"]);
		expect(mailBody.subject).toContain("ClientX");
		expect(mailBody.text).toContain("22222222-2222-4222-8222-222222222222");
		expect(mailBody.text).toContain("137");
		expect(mailBody.text).toContain("line1");
		expect(mailBody.text).toContain("line3");
	});

	it("uses fallback recipient when OPERATOR_ALERT_EMAIL is missing", async () => {
		const env = envForTest();
		(env as unknown as Record<string, string | undefined>).OPERATOR_ALERT_EMAIL = undefined;

		await notifyJobFailed(
			{
				deploymentId: "11111111-1111-4111-8111-111111111111",
				jobId: null,
				reason: "retry_exhausted",
				clientName: "ClientY",
				exitCode: null,
				logTail: null,
			},
			env,
		);

		const mail = captured.requests.find((r) => r.url.includes("api.resend.com"));
		const mailBody = mail?.body as { to: string[] };
		expect(mailBody.to).toEqual(["piotr@sobiecki.org"]);
	});

	it("does not block email when Telegram fetch throws", async () => {
		captured.spy.mockImplementation(async (input, init) => {
			const url = String(input);
			if (url.includes("api.telegram.org")) {
				throw new TypeError("telegram unreachable");
			}
			const bodyText = typeof init?.body === "string" ? init.body : "";
			let body: unknown = bodyText;
			try {
				body = JSON.parse(bodyText);
			} catch {
				// noop
			}
			captured.requests.push({ url, body });
			return new Response("{}", { status: 200 });
		});

		const result = await notifyJobFailed(
			{
				deploymentId: "11111111-1111-4111-8111-111111111111",
				jobId: "22222222-2222-4222-8222-222222222222",
				reason: "job_failed",
				clientName: "ClientZ",
				exitCode: 1,
				logTail: null,
			},
			envForTest(),
		);

		expect(result.telegram).toBe("err");
		expect(result.email).toBe("ok");

		const mail = captured.requests.find((r) => r.url.includes("api.resend.com"));
		expect(mail).toBeDefined();
	});
});
