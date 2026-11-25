// Forbidden (spec 7.1): Cc (except line feed and tab), Cf, Cs, Co, Cn, Zl, Zp,
// and every code point with the Unicode property Default_Ignorable_Code_Point
// (the ones those categories leave in, such as the variation selectors, the
// Hangul fillers and the combining grapheme joiner). One pattern, one pass.
const FORBIDDEN =
	/(?![\n\t])[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;
const encoder = new TextEncoder();

export function normalizeLineEnds(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}

export function stripForbidden(text: string): string {
	return normalizeLineEnds(text).replace(FORBIDDEN, "");
}

export function isConforming(text: string): boolean {
	return stripForbidden(text) === text;
}

export function utf8Length(text: string): number {
	return encoder.encode(text).length;
}

export function codePointLength(text: string): number {
	let count = 0;
	for (const _ of text) count++;
	return count;
}

/** Fails closed: NaN or a limit below 1 gives ""; a fractional limit is rounded down. */
export function cutToBytes(text: string, maxBytes: number): string {
	if (Number.isNaN(maxBytes)) return "";
	maxBytes = Math.floor(maxBytes);
	let bytes = 0;
	let end = 0;
	for (const char of text) {
		bytes += utf8Length(char);
		if (bytes > maxBytes) break;
		end += char.length;
	}
	return text.slice(0, end);
}

/** Fails closed: NaN or a limit below 1 gives ""; a fractional limit is rounded down. */
export function cutToCodePoints(text: string, maxCodePoints: number): string {
	if (Number.isNaN(maxCodePoints)) return "";
	maxCodePoints = Math.floor(maxCodePoints);
	let count = 0;
	let end = 0;
	for (const char of text) {
		if (count >= maxCodePoints) break;
		count++;
		end += char.length;
	}
	return text.slice(0, end);
}
