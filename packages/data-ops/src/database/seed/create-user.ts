import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { initDatabase } from "../setup";
import { auth_user, auth_account } from "../../drizzle/auth-schema";

async function createUser() {
	const email = process.argv[2];
	const password = process.argv[3];
	const name = process.argv[4] ?? "Operator";

	if (!email || !password) {
		console.error("Usage: tsx create-user.ts <email> <password> [name]");
		process.exit(1);
	}

	const db = initDatabase({
		host: process.env.DATABASE_HOST!,
		username: process.env.DATABASE_USERNAME!,
		password: process.env.DATABASE_PASSWORD!,
	});

	const existing = await db.select().from(auth_user).where(eq(auth_user.email, email));
	if (existing[0]) {
		console.error(`User ${email} already exists`);
		process.exit(1);
	}

	const userId = randomUUID();
	const accountId = randomUUID();
	const hashedPassword = await hashPassword(password);
	const now = new Date();

	await db.insert(auth_user).values({
		id: userId,
		name,
		email,
		emailVerified: true,
		approved: true,
		createdAt: now,
		updatedAt: now,
	});

	await db.insert(auth_account).values({
		id: accountId,
		accountId: userId,
		providerId: "credential",
		userId,
		password: hashedPassword,
		createdAt: now,
		updatedAt: now,
	});

	console.log(`Created approved user: ${email} (id: ${userId})`);
	process.exit(0);
}

createUser().catch((error) => {
	console.error(error);
	process.exit(1);
});
