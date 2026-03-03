/**
 * AES-256-GCM encryption via Web Crypto API.
 * Key format: base64-encoded 32 bytes.
 * Ciphertext format: {iv_hex}:{ciphertext_hex} (IV is 12 bytes).
 */

async function importKey(base64Key: string): Promise<CryptoKey> {
	const keyBytes = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
	if (keyBytes.length !== 32) {
		throw new Error("ENCRYPTION_KEY must be exactly 32 bytes (256 bits)");
	}
	return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
		"encrypt",
		"decrypt",
	]);
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function fromHex(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}

export async function encrypt(plaintext: string, base64Key: string): Promise<string> {
	const key = await importKey(base64Key);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);

	const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

	const cipherBytes = new Uint8Array(cipherBuffer);
	return `${toHex(iv)}:${toHex(cipherBytes)}`;
}

export async function decrypt(ciphertext: string, base64Key: string): Promise<string> {
	const parts = ciphertext.split(":");
	if (parts.length !== 2) {
		throw new Error("Invalid ciphertext format");
	}

	const ivPart = parts[0];
	const dataPart = parts[1];

	if (!ivPart || !dataPart) {
		throw new Error("Invalid ciphertext format: missing parts");
	}

	const key = await importKey(base64Key);
	const iv = fromHex(ivPart);
	const data = fromHex(dataPart);

	const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);

	return new TextDecoder().decode(plainBuffer);
}

export function generateEncryptionKey(): string {
	const keyBytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...keyBytes));
}
