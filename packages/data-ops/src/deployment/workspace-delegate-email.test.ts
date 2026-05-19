import { describe, expect, it } from "vitest";
import { validateWorkspaceDelegateEmailForDomain } from "./workspace-delegate-email";

describe("validateWorkspaceDelegateEmailForDomain", () => {
	it("accepts email in client domain", () => {
		expect(
			validateWorkspaceDelegateEmailForDomain("grota@sobiecki.org", "sobiecki.org"),
		).toBeUndefined();
	});

	it("rejects email outside client domain", () => {
		expect(validateWorkspaceDelegateEmailForDomain("piotr@gmail.com", "sobiecki.org")).toBe(
			"Email delegata musi byc w domenie sobiecki.org",
		);
	});

	it("normalizes domain with leading @", () => {
		expect(validateWorkspaceDelegateEmailForDomain("a@Firma.pl", "@firma.pl")).toBeUndefined();
	});
});
