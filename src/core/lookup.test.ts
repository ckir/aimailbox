// lookup.test.ts
import { expect, test } from "bun:test";
import type { Entry, PageEntry, ReplyEntry } from "./entry.ts";
import { problemEntry, T0 } from "./fixtures.ts";
import { listReplies, lookupGroup } from "./lookup.ts";

const okEntry = (entry: Entry): PageEntry => ({
	status: "ok",
	value: entry,
	cleaned: false,
});
const question = (noteNumber: number): Entry => ({
	formatVersion: 1,
	noteNumber,
	kind: "question",
	timeWritten: T0,
	summary: "q",
	warningTags: [],
	replyCount: 0,
});
const reply = (
	noteNumber: number,
	parentNoteNumber: number,
	parentGone: boolean,
): ReplyEntry => ({
	formatVersion: 1,
	noteNumber,
	kind: "reply",
	timeWritten: T0,
	summary: "r",
	warningTags: [],
	parentNoteNumber,
	parentGone,
});
const shownNumbers = (g: { shown: { entry: Entry }[] }) =>
	g.shown.map((s) => s.entry.noteNumber);

test("a lookup lists problems, questions and replies to a removed note, never a reply to a published one", () => {
	const entries = [
		problemEntry({ noteNumber: 1 }),
		question(2),
		reply(3, 1, false),
		reply(4, 9, true),
	].map(okEntry);
	expect(shownNumbers(lookupGroup("npm", entries, {}))).toEqual([4, 2, 1]);
	expect(
		shownNumbers(lookupGroup("npm", entries, { kinds: ["question"] })),
	).toEqual([2]);
	expect(
		shownNumbers(lookupGroup("npm", entries, { kinds: ["reply"] })),
	).toEqual([4]);
	expect(
		shownNumbers(
			lookupGroup("npm", entries, { kinds: ["problem", "question"] }),
		),
	).toEqual([2, 1]);
});
test("groups of ten, with the rest counted and reachable in the same order", () => {
	const entries = Array.from({ length: 23 }, (_, i) =>
		okEntry(problemEntry({ noteNumber: i + 1 })),
	);
	const first = lookupGroup("npm", entries, {});
	expect(shownNumbers(first)).toEqual([23, 22, 21, 20, 19, 18, 17, 16, 15, 14]);
	expect(first.notShown).toBe(13);
	const third = lookupGroup("npm", entries, { group: 2 });
	expect(shownNumbers(third)).toEqual([3, 2, 1]);
	expect(third.notShown).toBe(0);
	expect(lookupGroup("npm", entries, { group: 3 }).shown).toEqual([]);
});
test("a group number must be a non-negative integer, and kinds do not change the unknown-format report", () => {
	const entries: PageEntry[] = [
		okEntry(question(2)),
		{ status: "unknown-format", formatVersion: 2, noteNumber: 9 },
	];
	for (const group of [-1, 1.5, Number.NaN])
		expect(() => lookupGroup("npm", entries, { group })).toThrow(RangeError);
	const g = lookupGroup("npm", entries, { kinds: ["problem"] });
	expect(g.shown).toEqual([]);
	expect(g.unknownFormat).toEqual({ count: 1, noteNumbers: [9] });
});
test("words rank and do not filter; every shown entry carries its mark", () => {
	const entries = [
		problemEntry({
			noteNumber: 1,
			summary: "lock is stale",
			reportedVersion: "1.0.0",
		}),
		problemEntry({ noteNumber: 2, summary: "other" }),
	].map(okEntry);
	const g = lookupGroup("npm", entries, { query: "lock", installed: "1.0.0" });
	expect(g.shown.map((s) => [s.entry.noteNumber, s.mark])).toEqual([
		[1, "same-version"],
		[2, "unknown"],
	]);
	expect(g.notShown).toBe(0);
});
test("entries of an unknown format are reported apart, outside the order and the cap", () => {
	const unknown = (noteNumber?: number): PageEntry => ({
		status: "unknown-format",
		formatVersion: 2,
		...(noteNumber === undefined ? {} : { noteNumber }),
	});
	const entries = [
		...Array.from({ length: 10 }, (_, i) =>
			okEntry(problemEntry({ noteNumber: i + 1 })),
		),
		...Array.from({ length: 12 }, (_, i) => unknown(100 - i)),
		unknown(),
	];
	const g = lookupGroup("npm", entries, {});
	expect(shownNumbers(g)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
	expect(g.notShown).toBe(0);
	expect(g.unknownFormat.count).toBe(13);
	expect(g.unknownFormat.noteNumbers).toEqual([
		89, 90, 91, 92, 93, 94, 95, 96, 97, 98,
	]);
});
test("no entry is left out because of its mark", () => {
	const entries = [
		problemEntry({ noteNumber: 1, resolved: { time: T0 + 10 } }),
		problemEntry({ noteNumber: 2 }),
	].map(okEntry);
	const g = lookupGroup("npm", entries, {});
	expect(g.shown.map((s) => [s.entry.noteNumber, s.mark])).toEqual([
		[2, "unknown"],
		[1, "resolved"],
	]);
	expect(lookupGroup("npm", entries, { group: 1 }).unknownFormat).toEqual({
		count: 0,
		noteNumbers: [],
	});
});
test("a reply group number must be a non-negative integer too", () => {
	for (const group of [-2, 0.5, Number.NaN])
		expect(() => listReplies([reply(3, 1, false)], 1, group)).toThrow(
			RangeError,
		);
});
test("replies are listed oldest first, in bounded groups", () => {
	const entries: Entry[] = [
		reply(9, 1, false),
		reply(3, 1, false),
		reply(5, 2, false),
		problemEntry({ noteNumber: 1 }),
		...Array.from({ length: 10 }, (_, i) => reply(20 + i, 1, false)),
	];
	const first = listReplies(entries, 1);
	expect(first.shown.map((r) => r.noteNumber)).toEqual([
		3, 9, 20, 21, 22, 23, 24, 25, 26, 27,
	]);
	expect(first.notShown).toBe(2);
	expect(listReplies(entries, 1, 1).shown.map((r) => r.noteNumber)).toEqual([
		28, 29,
	]);
	expect(listReplies(entries, 7).shown).toEqual([]);
});
