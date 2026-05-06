const VISIBLE_CHARS = 4;
const MIN_LENGTH_FOR_REVEAL = VISIBLE_CHARS * 2 + 1;

export function maskSecret(value: string): string {
	if (value === "") return "";
	if (value.length < MIN_LENGTH_FOR_REVEAL) return "****";
	return `${value.slice(0, VISIBLE_CHARS)}****${value.slice(-VISIBLE_CHARS)}`;
}
