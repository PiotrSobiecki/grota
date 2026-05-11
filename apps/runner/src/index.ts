import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createRunBackup, realRcloneSpawnForBackup } from "./run-backup";
import { createRunGDriveRestore, realRcloneSpawnForGDriveRestore } from "./run-gdrive-restore";
import { createRunIngest } from "./run-ingest";
import { createRunMigrate } from "./run-migrate";
import { createRunScheduledCycle } from "./run-scheduled-cycle";
import { createVerifyB2, realRcloneSpawn } from "./verify-b2";

const VERSION = "0.1.0";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value || value.length === 0) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
	return value;
}

const token = requireEnv("GROTA_TOKEN");
const port = Number(process.env.GROTA_PORT ?? "7878");

const app = createApp({
	token,
	version: VERSION,
	verifyB2: createVerifyB2(realRcloneSpawn),
	runBackup: createRunBackup(realRcloneSpawnForBackup),
	runMigrate: createRunMigrate(realRcloneSpawnForBackup),
	runGDriveRestore: createRunGDriveRestore(realRcloneSpawnForGDriveRestore),
	runIngest: createRunIngest(realRcloneSpawnForGDriveRestore),
	runScheduledCycle: createRunScheduledCycle(realRcloneSpawnForGDriveRestore),
});

serve({ fetch: app.fetch, port }, (info) => {
	console.log(`grota-runner v${VERSION} listening on :${info.port}`);
});
