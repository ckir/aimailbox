// Forbidden: Cc (except line feed and tab), Cf, Cs, Co, Cn, Zl, Zp.
const FORBIDDEN = /(?![\n\t])[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu;
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

export function cutToBytes(text: string, maxBytes: number): string {
	let bytes = 0;
	let end = 0;
	for (const char of text) {
		bytes += utf8Length(char);
		if (bytes > maxBytes) break;
		end += char.length;
	}
	return text.slice(0, end);
}

export function cutToCodePoints(text: string, maxCodePoints: number): string {
	let count = 0;
	let end = 0;
	for (const char of text) {
		if (count === maxCodePoints) break;
		count++;
		end += char.length;
	}
	return text.slice(0, end);
}
