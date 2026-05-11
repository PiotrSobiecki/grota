import { createHmac, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = "hmac-sha256$";
const DEFAULT_PEPPER = "grota-auth-default-pepper";

function toHash(password: string, pepper?: string): string {
	const key = pepper && pepper.length > 0 ? pepper : DEFAULT_PEPPER;
	return createHmac("sha256", key).update(password).digest("hex");
}

export function hashPasswordFast(password: string, pepper?: string): string {
	return `${HASH_PREFIX}${toHash(password, pepper)}`;
}

export function verifyPasswordFast(input: {
	password: string;
	hash: string;
	pepper?: string;
}): boolean {
	if (!input.hash.startsWith(HASH_PREFIX)) {
		return false;
	}

	const actual = input.hash.slice(HASH_PREFIX.length);
	const expected = toHash(input.password, input.pepper);

	const actualBuffer = Buffer.from(actual, "utf8");
	const expectedBuffer = Buffer.from(expected, "utf8");
	if (actualBuffer.length !== expectedBuffer.length) {
		return false;
	}
	return timingSafeEqual(actualBuffer, expectedBuffer);
}
