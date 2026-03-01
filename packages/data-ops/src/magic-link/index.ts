export { getDeploymentByAdminToken, updateAdminMagicLink } from "./queries";
export {
	MagicLinkDeploymentParamSchema,
	MagicLinkTokenParamSchema,
} from "./schema";

/** Generate a cryptographically random 64-char hex token. */
export function generateMagicLinkToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Default expiry: 7 days from now. */
export function getMagicLinkExpiry(daysFromNow = 7): Date {
	const expiry = new Date();
	expiry.setDate(expiry.getDate() + daysFromNow);
	return expiry;
}

/** Check if a token is still valid (not expired). */
export function isMagicLinkValid(expiresAt: Date | null): boolean {
	if (!expiresAt) return false;
	return new Date() < expiresAt;
}

/** Rate limit check: at least 5 minutes since last send. */
export function canResendMagicLink(sentAt: Date | null): boolean {
	if (!sentAt) return true;
	const fiveMinutesAgo = new Date();
	fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
	return sentAt < fiveMinutesAgo;
}
