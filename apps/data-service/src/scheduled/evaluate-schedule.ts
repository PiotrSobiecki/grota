export type Schedule = {
	enabled: boolean;
	intervalHours: number;
	nextRunAt: Date | null;
};

export type Decision = {
	shouldRun: boolean;
	nextRunAt: Date;
};

export function evaluateSchedule(now: Date, schedule: Schedule): Decision {
	if (!schedule.enabled) {
		return { shouldRun: false, nextRunAt: schedule.nextRunAt ?? now };
	}
	if (schedule.nextRunAt && schedule.nextRunAt > now) {
		return { shouldRun: false, nextRunAt: schedule.nextRunAt };
	}
	const nextRunAt = new Date(now.getTime() + schedule.intervalHours * 60 * 60 * 1000);
	return { shouldRun: true, nextRunAt };
}
