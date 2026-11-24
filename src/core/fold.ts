import { CASE_FOLDING } from "./casefold-data.ts";
import { LIMITS } from "./limits.ts";

/** The folded copy used only for matching: NFKC, full case fold, NFKC again. Never stored or shown. */
export function foldText(text: string): string {
	let folded = "";
	for (const char of text.normalize("NFKC")) {
		const codePoint = char.codePointAt(0);
		folded +=
			(codePoint === undefined ? undefined : CASE_FOLDING.get(codePoint)) ??
			char;
	}
	return folded.normalize("NFKC");
}

/** Words of the folded copy: runs of letters and decimal digits. */
export function wordsOf(text: string): string[] {
	return foldText(text)
		.split(/[^\p{L}\p{Nd}]+/u)
		.filter((word) => word !== "");
}

/** The first LIMITS.queryWords distinct words of the query, in first-appearance order. */
export function queryWords(query: string): string[] {
	return [...new Set(wordsOf(query))].slice(0, LIMITS.queryWords);
}

/** How many distinct `words` are among the words of `text`. */
export function countMatches(words: readonly string[], text: string): number {
	const present = new Set(wordsOf(text));
	let count = 0;
	for (const word of new Set(words)) {
		if (present.has(word)) count += 1;
	}
	return count;
}
