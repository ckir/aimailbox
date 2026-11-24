import type { Ecosystem } from "./ecosystem.ts";
import type { Entry, PageEntry, ReplyEntry } from "./entry.ts";
import { LIMITS } from "./limits.ts";
import type { Mark } from "./mark.ts";
import { markEntry } from "./mark.ts";
import { sortEntries } from "./order.ts";

export type LookupKind = "problem" | "question" | "reply";
export type LookupGroup = {
	shown: { entry: Entry; mark: Mark }[];
	notShown: number;
	unknownFormat: { count: number; noteNumbers: number[] };
};

const ALL_KINDS: readonly LookupKind[] = ["problem", "question", "reply"];

function groupNumber(group: number | undefined): number {
	const g = group ?? 0;
	if (!Number.isInteger(g) || g < 0) {
		throw new RangeError("group must be a non-negative integer");
	}
	return g;
}

/** One group of what a lookup lists (7.2): problems, questions and replies to a removed note, in the order of 12.5. */
export function lookupGroup(
	ecosystem: Ecosystem,
	entries: readonly PageEntry[],
	options: {
		kinds?: readonly LookupKind[];
		installed?: string;
		query?: string;
		group?: number;
	},
): LookupGroup {
	const group = groupNumber(options.group);
	const kinds = options.kinds ?? ALL_KINDS;
	const listed: Entry[] = [];
	let unknownCount = 0;
	const unknownNumbers: number[] = [];
	for (const item of entries) {
		if (item.status === "unknown-format") {
			unknownCount += 1;
			if (item.noteNumber !== undefined) unknownNumbers.push(item.noteNumber);
			continue;
		}
		const entry = item.value;
		if (entry.kind === "reply" && !entry.parentGone) continue;
		if (kinds.includes(entry.kind)) listed.push(entry);
	}
	unknownNumbers.sort((a, b) => a - b);
	const sorted = sortEntries(
		ecosystem,
		listed,
		options.installed,
		options.query ?? "",
	);
	const start = group * LIMITS.summariesPerGroup;
	const end = start + LIMITS.summariesPerGroup;
	return {
		shown: sorted.slice(start, end).map((entry) => ({
			entry,
			mark: markEntry(ecosystem, entry, options.installed),
		})),
		notShown: Math.max(0, sorted.length - end),
		unknownFormat: {
			count: unknownCount,
			noteNumbers: unknownNumbers.slice(0, LIMITS.unknownFormatListed),
		},
	};
}

/** The replies to one note, oldest first, in groups of LIMITS.repliesPerGroup. */
export function listReplies(
	entries: readonly Entry[],
	parentNoteNumber: number,
	group?: number,
): { shown: ReplyEntry[]; notShown: number } {
	const g = groupNumber(group);
	const replies = entries
		.filter(
			(entry): entry is ReplyEntry =>
				entry.kind === "reply" && entry.parentNoteNumber === parentNoteNumber,
		)
		.sort((a, b) => a.noteNumber - b.noteNumber);
	const start = g * LIMITS.repliesPerGroup;
	const end = start + LIMITS.repliesPerGroup;
	return {
		shown: replies.slice(start, end),
		notShown: Math.max(0, replies.length - end),
	};
}
