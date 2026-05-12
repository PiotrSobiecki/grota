import { runDueSchedules } from "./run-due-schedules";

export async function handleScheduled(
	_controller: ScheduledController,
	env: Env,
	ctx: ExecutionContext,
) {
	ctx.waitUntil(runDueSchedules(env, new Date()));
}
