/**
 * FOR TESTS ONLY. Never imported by production code.
 *
 * Builds secret-shaped strings at run time, from a split prefix plus random
 * characters, so that no token-shaped literal is ever committed (the secret scan
 * rejects one, even a fake). Every prefix below is written in two or more pieces
 * for the same reason: do not join them.
 */

const UPPER_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const URL_SAFE = `${ALNUM}_-`;

/** `count` characters of `alphabet`, each equally likely (bytes past the last whole multiple are thrown away). */
function randomChars(count: number, alphabet: string): string {
	const limit = 256 - (256 % alphabet.length);
	let out = "";
	while (out.length < count) {
		for (const byte of crypto.getRandomValues(new Uint8Array(count * 2))) {
			if (byte < limit && out.length < count) {
				out += alphabet.charAt(byte % alphabet.length);
			}
		}
	}
	return out;
}

/** `count` random letters and digits. */
export function randomAlnum(count: number): string {
	return randomChars(count, ALNUM);
}

/** A string shaped like a secret of the scanner rule `kind`, different on every call. */
export function fakeSecret(kind: string): string {
	switch (kind) {
		case "aws-access-key-id":
			return `${"AK" + "IA"}${randomChars(16, UPPER_DIGITS)}`;
		case "github-token":
			return `${"gh" + "p_"}${randomChars(36, ALNUM)}`;
		case "slack-token":
			return `${"xo" + "xb-"}${randomChars(24, ALNUM)}`;
		case "npm-token":
			return `${"np" + "m_"}${randomChars(36, ALNUM)}`;
		case "api-key-prefix":
			return `${"s" + "k-"}${randomChars(32, URL_SAFE)}`;
		case "jwt":
			return [
				`${"ey" + "J"}${randomChars(20, URL_SAFE)}`,
				`${"ey" + "J"}${randomChars(20, URL_SAFE)}`,
				randomChars(24, URL_SAFE),
			].join(".");
		case "private-key-block":
			return `${"-----BEGIN " + "RSA PRIV" + "ATE KEY-----"}`;
		default:
			throw new Error(`no fake secret of kind ${kind}`);
	}
}
