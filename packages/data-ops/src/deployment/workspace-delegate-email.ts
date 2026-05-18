/** Returns a Polish validation message, or undefined if valid. */
export function validateWorkspaceDelegateEmailForDomain(
	email: string,
	domain: string,
): string | undefined {
	const normalizedDomain = domain.trim().toLowerCase().replace(/^@/, "");
	if (!normalizedDomain) {
		return "Domena jest wymagana";
	}

	const trimmedEmail = email.trim().toLowerCase();
	const atIndex = trimmedEmail.lastIndexOf("@");
	if (atIndex <= 0 || atIndex === trimmedEmail.length - 1) {
		return "Nieprawidlowy format email";
	}

	const emailDomain = trimmedEmail.slice(atIndex + 1);
	if (emailDomain !== normalizedDomain) {
		return `Email delegata musi byc w domenie ${normalizedDomain}`;
	}

	return undefined;
}
