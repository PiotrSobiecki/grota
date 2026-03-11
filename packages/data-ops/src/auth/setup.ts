import { APIError, type BetterAuthOptions, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { verifyTurnstile } from "@/auth/turnstile";

export const createBetterAuth = (config: {
	database: BetterAuthOptions["database"];
	secret?: BetterAuthOptions["secret"];
	baseURL?: BetterAuthOptions["baseURL"];
	turnstileSecretKey?: string;
}): ReturnType<typeof betterAuth> => {
	return betterAuth({
		database: config.database,
		secret: config.secret,
		baseURL: config.baseURL,
		emailAndPassword: {
			enabled: true,
			disableSignUp: true,
		},
		user: {
			modelName: "auth_user",
			additionalFields: {
				approved: {
					type: "boolean",
					required: true,
					defaultValue: false,
					input: false,
				},
			},
		},
		session: {
			modelName: "auth_session",
		},
		verification: {
			modelName: "auth_verification",
		},
		account: {
			modelName: "auth_account",
		},
		hooks: {
			before: config.turnstileSecretKey
				? createAuthMiddleware(async (ctx) => {
						if (ctx.path !== "/sign-in/email") return;
						const secretKey = config.turnstileSecretKey as string;
						const token = (ctx.body as { turnstileToken?: string })?.turnstileToken;
						if (!token) {
							throw new APIError("FORBIDDEN", { message: "Turnstile token required" });
						}
						const result = await verifyTurnstile(token, secretKey);
						if (!result.ok) {
							throw new APIError("FORBIDDEN", { message: result.error });
						}
					})
				: undefined,
		},
	});
};
