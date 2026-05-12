import { fromZonedTime, toZonedTime } from "date-fns-tz";

export type Schedule = {
	enabled: boolean;
	intervalHours: number;
	anchorTime: string;
	anchorTimezone: string;
	lastRunAt: Date | null;
	nextRunAt: Date | null;
};

export type Decision = {
	shouldRun: boolean;
	nextRunAt: Date;
};

function parseAnchorTime(anchorTime: string): { hour: number; minute: number } {
	const [hStr, mStr] = anchorTime.split(":");
	const hour = Number(hStr);
	const minute = Number(mStr);
	if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
		throw new Error(`Invalid anchorTime: ${anchorTime}`);
	}
	return { hour, minute };
}

/**
 * Compute the next anchored run time strictly after `now` in the given tz.
 * For intervals < 24h: grid of slots starting at anchorTime, step = intervalHours, wrapping at 24h.
 * For intervals >= 24h: anchor_time on the next eligible day (today if in future, else tomorrow+).
 * DST spring-forward: if the resulting local wall time does not exist, date-fns-tz
 * resolves it to the equivalent UTC instant (shifted forward by the gap).
 * DST fall-back: doubled local times resolve to the first occurrence.
 */
function nextAnchoredRun(now: Date, schedule: Schedule): Date {
	const { anchorTime, anchorTimezone, intervalHours } = schedule;
	const { hour, minute } = parseAnchorTime(anchorTime);
	const zonedNow = toZonedTime(now, anchorTimezone);

	if (intervalHours < 24) {
		// Grid within a day: anchor + k*interval mod 24h
		const slots: Date[] = [];
		for (let day = 0; day <= 1; day++) {
			for (let h = hour; h < hour + 24; h += intervalHours) {
				const slot = new Date(zonedNow);
				slot.setDate(zonedNow.getDate() + day);
				slot.setHours(h, minute, 0, 0);
				slots.push(slot);
			}
		}
		for (const local of slots) {
			const utc = fromZonedTime(local, anchorTimezone);
			if (utc.getTime() > now.getTime()) return utc;
		}
	}

	// intervalHours >= 24: anchor_time on next eligible day
	const candidate = new Date(zonedNow);
	candidate.setHours(hour, minute, 0, 0);
	const stepDays = Math.max(1, Math.round(intervalHours / 24));
	let attemptUtc = fromZonedTime(candidate, anchorTimezone);
	if (attemptUtc.getTime() <= now.getTime()) {
		candidate.setDate(candidate.getDate() + stepDays);
		attemptUtc = fromZonedTime(candidate, anchorTimezone);
	}
	return attemptUtc;
}

export function evaluateSchedule(now: Date, schedule: Schedule): Decision {
	if (!schedule.enabled) {
		return { shouldRun: false, nextRunAt: schedule.nextRunAt ?? now };
	}
	if (schedule.nextRunAt && schedule.nextRunAt > now) {
		return { shouldRun: false, nextRunAt: schedule.nextRunAt };
	}
	return { shouldRun: true, nextRunAt: nextAnchoredRun(now, schedule) };
}
