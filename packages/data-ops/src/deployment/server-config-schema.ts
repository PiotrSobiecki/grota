export type ValidationResult = { ok: true } | { ok: false; error: string };

const SLOT_PATTERN = /^(\d{1,2}):(\d{2}),(\d+)([KMGB])$/;

export function validateBandwidthLimit(input: string): ValidationResult {
	if (input === "") return { ok: true };
	const slots = input.split(/\s+/);
	for (const slot of slots) {
		const match = SLOT_PATTERN.exec(slot);
		if (!match) {
			return { ok: false, error: `Invalid bandwidth slot: "${slot}"` };
		}
		const hour = Number(match[1]);
		const minute = Number(match[2]);
		if (hour > 23 || minute > 59) {
			return { ok: false, error: `Invalid time in slot: "${slot}"` };
		}
	}
	return { ok: true };
}
