import { expect, test } from "bun:test";
import type { Entry } from "./entry.ts";
import { problemEntry, T0, workedEntry } from "./fixtures.ts";
import { markEntry } from "./mark.ts";

test("the worked entry, for every installed version both agents computed", () => {
	expect(markEntry("npm", workedEntry, undefined)).toBe("unknown");
	expect(markEntry("npm", workedEntry, "1.1.0")).toBe("unknown");
	expect(markEntry("npm", workedEntry, "1.2.0")).toBe("same-version");
	expect(markEntry("npm", workedEntry, "1.2.1")).toBe("same-version");
	expect(markEntry("npm", workedEntry, "1.3.0")).toBe(
		"not-reproduced-on-newer",
	);
	expect(markEntry("npm", workedEntry, "1.4.0")).toBe(
		"not-reproduced-on-newer",
	);
	expect(markEntry("npm", workedEntry, "v1.3.0+local")).toBe(
		"not-reproduced-on-newer",
	);
});
test("mark 2 needs the threshold, counts non-burst votes only, and never applies where versions do not order", () => {
	expect(markEntry("npm", workedEntry, "1.3.0", 4)).toBe(
		"disputed-on-your-version",
	); // row 1.3.0: 3 against 0
	expect(markEntry("npm", workedEntry, "1.4.0", 4)).toBe("unknown");
	const burst = {
		...workedEntry,
		rows: workedEntry.rows.map((r) =>
			r.version === "1.3.0" ? { ...r, doesNotReproduceNonBurst: 2 } : r,
		),
	};
	expect(markEntry("npm", burst, "1.4.0")).toBe("unknown");
	expect(
		markEntry(
			"pypi",
			{ ...workedEntry, highestConfirmedVersion: undefined },
			"1.4.0",
		),
	).toBe("unknown");
	expect(
		markEntry(
			"pypi",
			{ ...workedEntry, highestConfirmedVersion: undefined },
			"1.3.0",
		),
	).toBe("disputed-on-your-version");
});
test("mark 2 uses the highest affected version and ignores one that does not match the grammar", () => {
	const observed = { ...workedEntry, authorObservedVersion: "1.3.0" };
	expect(markEntry("npm", observed, "1.4.0")).toBe("unknown"); // nothing is newer than 1.3.0 and not newer than 1.4.0
	expect(markEntry("npm", observed, "1.3.0")).toBe("disputed-on-your-version"); // mark 2 fails (not newer); row 1.3.0 is 3 against 0
	const odd = {
		...workedEntry,
		reportedVersion: "latest",
		highestConfirmedVersion: undefined,
	};
	expect(markEntry("npm", odd, "1.4.0")).toBe("unknown"); // no affected version known
});
test("a dropped row contributes to no mark", () => {
	const dropped = {
		...workedEntry,
		rows: workedEntry.rows.filter((r) => r.version !== "1.3.0"),
	};
	expect(markEntry("npm", dropped, "1.4.0")).toBe("unknown");
	const droppedConfirm = {
		...workedEntry,
		rows: workedEntry.rows.filter((r) => r.version !== "1.2.1"),
	};
	expect(markEntry("npm", droppedConfirm, "1.2.1")).toBe("unknown"); // highest confirmed version alone is not mark 4
});
test("mark 3: disputed on your version outranks same version", () => {
	const e = problemEntry({
		reportedVersion: "2.0.0",
		rows: [
			{
				version: "2.0.0",
				confirmTotal: 1,
				confirmNonBurst: 1,
				doesNotReproduceTotal: 2,
				doesNotReproduceNonBurst: 2,
			},
		],
	});
	expect(markEntry("npm", e, "2.0.0")).toBe("disputed-on-your-version");
	expect(markEntry("npm", e, "v2.0.0+x")).toBe("disputed-on-your-version");
	const even = problemEntry({
		reportedVersion: "2.0.0",
		rows: [
			{
				version: "2.0.0",
				confirmTotal: 2,
				confirmNonBurst: 2,
				doesNotReproduceTotal: 2,
				doesNotReproduceNonBurst: 2,
			},
		],
	});
	expect(markEntry("npm", even, "2.0.0")).toBe("same-version");
});
test("mark 4: reported, author-observed, or a row with a non-burst confirmation", () => {
	expect(
		markEntry("tool", problemEntry({ reportedVersion: "2024-01" }), "2024-01"),
	).toBe("same-version");
	expect(
		markEntry("tool", problemEntry({ reportedVersion: "2024-01" }), "v2024-01"),
	).toBe("same-version");
	expect(
		markEntry("npm", problemEntry({ authorObservedVersion: "3.1.0" }), "3.1.0"),
	).toBe("same-version");
	const burstOnly = problemEntry({
		rows: [
			{
				version: "4.0.0",
				confirmTotal: 5,
				confirmNonBurst: 0,
				doesNotReproduceTotal: 0,
				doesNotReproduceNonBurst: 0,
			},
		],
	});
	expect(markEntry("npm", burstOnly, "4.0.0")).toBe("unknown");
	expect(
		markEntry("npm", problemEntry({ reportedVersion: "1.2" }), "1.2.0"),
	).toBe("unknown"); // not orderable: whole-string equality
});
test("mark 1: resolved", () => {
	const resolved = (extra: object) =>
		problemEntry({
			reportedVersion: "1.0.0",
			resolved: { time: T0 + 1000 },
			...extra,
		});
	expect(markEntry("npm", resolved({}), undefined)).toBe("resolved");
	expect(markEntry("npm", resolved({}), "1.0.0")).toBe("resolved");
	const confirmedBefore = {
		confirm: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0 + 1000,
		},
	};
	expect(markEntry("npm", resolved(confirmedBefore), "1.0.0")).toBe("resolved"); // not later than the mark
	const confirmedAfter = {
		confirm: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0 + 1001,
		},
	};
	expect(markEntry("npm", resolved(confirmedAfter), "1.0.0")).toBe(
		"same-version",
	); // a later confirmation removes it
	const burstAfter = { confirm: { total: 6, nonBurstTotal: 0, burst: true } };
	expect(markEntry("npm", resolved(burstAfter), "1.0.0")).toBe("resolved"); // a burst does not cancel it
});
test("mark 1 with a version", () => {
	const from = problemEntry({
		reportedVersion: "1.0.0",
		resolved: { time: T0 + 1000, version: "1.5.0" },
	});
	expect(markEntry("npm", from, "1.5.0")).toBe("resolved");
	expect(markEntry("npm", from, "2.0.0")).toBe("resolved");
	expect(markEntry("npm", from, "1.4.9")).toBe("unknown");
	expect(markEntry("npm", from, "1.0.0")).toBe("same-version");
	expect(markEntry("npm", from, undefined)).toBe("unknown");
	const tool = problemEntry({
		resolved: { time: T0 + 1000, version: "2024-02" },
	});
	expect(markEntry("tool", tool, "2024-02")).toBe("resolved");
	expect(markEntry("tool", tool, "2024-03")).toBe("unknown"); // equality only
});
test("mark 2: the upper bound, the highest confirmed version, and what it ignores", () => {
	expect(markEntry("npm", workedEntry, "1.2.5")).toBe("unknown"); // row 1.3.0 is newer than the installed version
	const confirmedHigher = problemEntry({
		reportedVersion: "1.0.0",
		highestConfirmedVersion: "2.0.0",
		rows: [
			{
				version: "1.5.0",
				confirmTotal: 0,
				confirmNonBurst: 0,
				doesNotReproduceTotal: 3,
				doesNotReproduceNonBurst: 3,
			},
		],
	});
	expect(markEntry("npm", confirmedHigher, "2.5.0")).toBe("unknown"); // 1.5.0 is not newer than 2.0.0
	expect(
		markEntry(
			"npm",
			{ ...confirmedHigher, highestConfirmedVersion: undefined },
			"2.5.0",
		),
	).toBe("not-reproduced-on-newer");
	const oddReported = { ...workedEntry, reportedVersion: "latest" };
	expect(markEntry("npm", oddReported, "1.3.0")).toBe(
		"not-reproduced-on-newer",
	); // 1.2.1 still counts
	const oddRow = problemEntry({
		reportedVersion: "1.0.0",
		rows: [
			{
				version: "nightly",
				confirmTotal: 0,
				confirmNonBurst: 0,
				doesNotReproduceTotal: 5,
				doesNotReproduceNonBurst: 5,
			},
		],
	});
	expect(markEntry("npm", oddRow, "2.0.0")).toBe("unknown"); // a row that cannot be ordered is in no sum
	expect(markEntry("npm", workedEntry, "latest")).toBe("unknown"); // an installed version that cannot be ordered
});
test("mark 1 outranks marks 2 and 3", () => {
	const resolved = { ...workedEntry, resolved: { time: T0 + 1000 } };
	expect(markEntry("npm", resolved, "1.4.0")).toBe("resolved");
	expect(markEntry("npm", resolved, "1.3.0", 4)).toBe("resolved");
});
test("questions and replies", () => {
	const q: Entry = {
		formatVersion: 1,
		noteNumber: 7,
		kind: "question",
		timeWritten: T0,
		summary: "q",
		warningTags: [],
		replyCount: 0,
		version: "1.0.0",
	};
	expect(markEntry("npm", q, "1.0.0")).toBe("same-version");
	expect(markEntry("npm", q, "2.0.0")).toBe("unknown");
	expect(markEntry("npm", { ...q, resolved: { time: T0 } }, undefined)).toBe(
		"resolved",
	);
	const r: Entry = {
		formatVersion: 1,
		noteNumber: 8,
		kind: "reply",
		timeWritten: T0,
		summary: "r",
		warningTags: [],
		parentNoteNumber: 7,
		parentGone: true,
	};
	expect(markEntry("npm", r, "1.0.0")).toBe("unknown");
});
