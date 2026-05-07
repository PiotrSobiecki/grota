const MASK = "***REDACTED***";

const PATTERNS: Array<[RegExp, string]> = [
	[/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, `Bearer ${MASK}`],
	[/(account\s*=\s*)[^\s,;]+/gi, `$1${MASK}`],
	[/(\bkey\s*=\s*)[^\s,;]+/gi, `$1${MASK}`],
	[/(app_key\s*=\s*)[^\s&"',;]+/gi, `$1${MASK}`],
	[/("(?:refresh_token|access_token|app_key|api_key|password)"\s*:\s*")[^"]*(")/gi, `$1${MASK}$2`],
	[/((?:GROTA_TOKEN|API_TOKEN|RUNNER_TOKEN|ENCRYPTION_KEY)\s*=\s*)[^\s]+/gi, `$1${MASK}`],
];

export function sanitizeLogLine(line: string): string {
	let result = line;
	for (const [pattern, replacement] of PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	return result;
}
