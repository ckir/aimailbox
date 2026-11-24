// order.test.ts
import { expect, test } from "bun:test";
import { problemEntry, T0, workedEntry } from "./fixtures.ts";
import { compareEntries, MARK_RANK, orderKeys, sortEntries } from "./order.ts";

const numbers = (entries: { noteNumber: number }[]) =>
	entries.map((e) => e.noteNumber);

test("the worked entry's keys with one matching word and 1.2.1 installed", () => {
	expect(orderKeys("npm", workedEntry, "1.2.1", ["lock"])).toEqual({
		words: 1,
		markRank: MARK_RANK["same-version"],
		balance: 1,
		time: T0 + 500,
		noteNumber: 41,
	});
});
test("the mark order is same, unknown, disputed, not reproduced, resolved", () => {
	expect(MARK_RANK).toEqual({
		"same-version": 0,
		unknown: 1,
		"disputed-on-your-version": 2,
		"not-reproduced-on-newer": 3,
		resolved: 4,
	});
});
test("key 1 alone: more distinct words first; no match is listed last, not dropped", () => {
	const a = problemEntry({ noteNumber: 1, summary: "lock file is stale" });
	const b = problemEntry({ noteNumber: 2, summary: "lock is held" });
	const c = problemEntry({ noteNumber: 3, summary: "nothing relevant" });
	expect(
		numbers(sortEntries("npm", [c, b, a], undefined, "lock file")),
	).toEqual([1, 2, 3]);
});
test("key 1 reads the failure signature and matches whole folded words", () => {
	const sig = problemEntry({
		noteNumber: 1,
		summary: "install fails",
		failureSignature: "E_LOCK busy",
	});
	const part = problemEntry({ noteNumber: 2, summary: "lockfile fails" });
	expect(numbers(sortEntries("npm", [part, sig], undefined, "LOCK"))).toEqual([
		1, 2,
	]);
});
test("key 2 alone: a disputed note ranks below a same-version one and below an unknown one", () => {
	const same = problemEntry({ noteNumber: 1, reportedVersion: "2.0.0" });
	const unknown = problemEntry({ noteNumber: 2, reportedVersion: "1.0.0" });
	const disputed = problemEntry({
		noteNumber: 3,
		rows: [
			{
				version: "2.0.0",
				confirmTotal: 0,
				confirmNonBurst: 0,
				doesNotReproduceTotal: 1,
				doesNotReproduceNonBurst: 1,
			},
		],
		doesNotReproduce: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0,
		},
	});
	const resolved = problemEntry({ noteNumber: 4, resolved: { time: T0 + 10 } });
	expect(
		numbers(
			sortEntries("npm", [resolved, disputed, unknown, same], "2.0.0", ""),
		),
	).toEqual([1, 2, 3, 4]);
});
test("key 3 alone: the non-burst balance, higher first", () => {
	const two = problemEntry({
		noteNumber: 2,
		confirm: { total: 9, nonBurstTotal: 2, burst: true, lastNonBurstTime: T0 },
	});
	const three = problemEntry({
		noteNumber: 1,
		confirm: { total: 3, nonBurstTotal: 3, burst: false, lastNonBurstTime: T0 },
	});
	expect(numbers(sortEntries("npm", [two, three], undefined, ""))).toEqual([
		1, 2,
	]); // key 5 alone would say 2, 1
});
test("key 4 alone: the last non-burst confirmation, or the time written, later first", () => {
	const confirmedLate = problemEntry({
		noteNumber: 1,
		timeWritten: T0,
		confirm: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0 + 900,
		},
		doesNotReproduce: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0,
		},
	});
	const writtenLater = problemEntry({ noteNumber: 2, timeWritten: T0 + 500 });
	expect(
		numbers(sortEntries("npm", [writtenLater, confirmedLate], undefined, "")),
	).toEqual([1, 2]);
});
test("key 5 alone: the higher number first", () => {
	expect(
		numbers(
			sortEntries(
				"npm",
				[problemEntry({ noteNumber: 5 }), problemEntry({ noteNumber: 6 })],
				undefined,
				"",
			),
		),
	).toEqual([6, 5]);
});
test("each key outranks the next one when they disagree", () => {
	// key 1 over key 2: a matching unknown entry before a same-version one that does not match
	const matches = problemEntry({ noteNumber: 1, summary: "lock is stale" });
	const sameVersion = problemEntry({ noteNumber: 2, reportedVersion: "2.0.0" });
	expect(
		numbers(sortEntries("npm", [sameVersion, matches], "2.0.0", "lock")),
	).toEqual([1, 2]);
	// key 2 over key 3: same version with balance 0 before unknown with balance 5
	const same = problemEntry({ noteNumber: 1, reportedVersion: "2.0.0" });
	const popular = problemEntry({
		noteNumber: 2,
		confirm: {
			total: 5,
			nonBurstTotal: 5,
			burst: false,
			lastNonBurstTime: T0 + 900,
		},
	});
	expect(numbers(sortEntries("npm", [popular, same], "2.0.0", ""))).toEqual([
		1, 2,
	]);
	// key 3 over key 4: balance 2 confirmed long ago before balance 1 confirmed just now
	const older = problemEntry({
		noteNumber: 1,
		confirm: { total: 2, nonBurstTotal: 2, burst: false, lastNonBurstTime: T0 },
	});
	const newer = problemEntry({
		noteNumber: 2,
		confirm: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0 + 900,
		},
	});
	expect(numbers(sortEntries("npm", [newer, older], undefined, ""))).toEqual([
		1, 2,
	]);
});
test("the comparison is a total order", () => {
	const k = orderKeys("npm", workedEntry, "1.2.1", []);
	expect(compareEntries(k, k)).toBe(0);
	expect(compareEntries(k, { ...k, noteNumber: 40 })).toBeLessThan(0);
});
