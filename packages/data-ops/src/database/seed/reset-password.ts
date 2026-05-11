import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { hashPasswordFast } from "../../auth/password";
import { auth_account, auth_user } from "../../drizzle/auth-schema";
import { initDatabase } from "../setup";

async function resetPassword() {
	const email = process.argv[2];
	const password = process.argv[3];

	if (!email || !password) {
		console.error("Usage: tsx reset-password.ts <email> <new-password>");
		process.exit(1);
	}

	const db = initDatabase({
		host: process.env.DATABASE_HOST!,
		username: process.env.DATABASE_USERNAME!,
		password: process.env.DATABASE_PASSWORD!,
	});

	const user = await db.select().from(auth_user).where(eq(auth_user.email, email));
	if (!user[0]) {
		console.error(`User ${email} not found`);
		process.exit(1);
	}

	const userId = user[0].id;
	const hashedPassword = hashPasswordFast(password, process.env.BETTER_AUTH_SECRET);
	const now = new Date();

	const credentialAccount = await db
		.select()
		.from(auth_account)
		.where(and(eq(auth_account.userId, userId), eq(auth_account.providerId, "credential")));

	if (!credentialAccount[0]) {
		await db.insert(auth_account).values({
			id: randomUUID(),
			accountId: userId,
			providerId: "credential",
			userId,
			password: hashedPassword,
			createdAt: now,
			updatedAt: now,
		});
		console.log(`Created credential account and reset password for ${email}`);
		process.exit(0);
	}

	await db
		.update(auth_account)
		.set({ password: hashedPassword, updatedAt: now })
		.where(eq(auth_account.id, credentialAccount[0].id));

	console.log(`Password reset for ${email}`);
	process.exit(0);
}

resetPassword().catch((error) => {
	console.error(error);
	process.exit(1);
});
