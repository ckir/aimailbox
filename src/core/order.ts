import type { Ecosystem } from "./ecosystem.ts";
import type { Entry } from "./entry.ts";
import { countMatches, queryWords } from "./fold.ts";
import type { Mark } from "./mark.ts";
import { markEntry } from "./mark.ts";

export type OrderKeys = {
	words: number;
	markRank: number;
	balance: number;
	time: number;
	noteNumber: number;
};

/** 12.5 key 2: lower is listed first. */
export const MARK_RANK: Record<Mark, number> = {
	"same-version": 0,
	unknown: 1,
	"disputed-on-your-version": 2,
	"not-reproduced-on-newer": 3,
	resolved: 4,
};

/** The five keys of 12.5 for one entry. */
export function orderKeys(
	ecosystem: Ecosystem,
	entry: Entry,
	installed: string | undefined,
	words: readonly string[],
): OrderKeys {
	let text = entry.summary;
	let balance = 0;
	let time = entry.timeWritten;
	if (entry.kind === "problem") {
		if (entry.failureSignature !== undefined) {
			text = `${entry.summary}\n${entry.failureSignature}`;
		}
		balance =
			entry.confirm.nonBurstTotal - entry.doesNotReproduce.nonBurstTotal;
		time = entry.confirm.lastNonBurstTime ?? entry.timeWritten;
	}
	return {
		words: words.length === 0 ? 0 : countMatches(words, text),
		markRank: MARK_RANK[markEntry(ecosystem, entry, installed)],
		balance,
		time,
		noteNumber: entry.noteNumber,
	};
}

/** Negative when `a` is listed first: more words, lower mark rank, higher balance, later time, higher number. */
export function compareEntries(a: OrderKeys, b: OrderKeys): number {
	if (a.words !== b.words) return b.words - a.words;
	if (a.markRank !== b.markRank) return a.markRank - b.markRank;
	if (a.balance !== b.balance) return b.balance - a.balance;
	if (a.time !== b.time) return b.time - a.time;
	return b.noteNumber - a.noteNumber;
}

/** Words rank and never filter: every entry is returned. */
export function sortEntries(
	ecosystem: Ecosystem,
	entries: readonly Entry[],
	installed: string | undefined,
	query: string,
): Entry[] {
	const words = queryWords(query);
	return entries
		.map((entry) => ({
			entry,
			keys: orderKeys(ecosystem, entry, installed, words),
		}))
		.sort((a, b) => compareEntries(a.keys, b.keys))
		.map((item) => item.entry);
}
