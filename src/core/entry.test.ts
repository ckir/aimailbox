import { expect, test } from "bun:test";
import { readDigestPage, readEntry, validateEntry } from "./entry.ts";
import { problemEntry, T0, workedEntry } from "./fixtures.ts";

const questionEntry = {
	formatVersion: 1,
	noteNumber: 7,
	kind: "question",
	timeWritten: T0,
	summary: "how to pin?",
	warningTags: [],
	replyCount: 0,
};
const replyEntry = {
	formatVersion: 1,
	noteNumber: 8,
	kind: "reply",
	timeWritten: T0,
	summary: "use --exact",
	warningTags: [],
	parentNoteNumber: 7,
	parentGone: false,
};

test("the worked entry and one of each kind are valid and read back unchanged", () => {
	for (const e of [workedEntry, problemEntry(), questionEntry, replyEntry]) {
		expect<unknown>(validateEntry("npm", e)).toEqual({ ok: true, value: e });
		expect<unknown>(readEntry(e)).toEqual({
			status: "ok",
			value: e,
			cleaned: false,
		});
	}
});
test("structural faults are unparseable", () => {
	const faults: unknown[] = [
		null,
		{},
		{ ...workedEntry, formatVersion: 0 },
		{ ...workedEntry, noteNumber: 0 },
		{ ...workedEntry, noteNumber: 1e30 },
		{ ...workedEntry, timeWritten: -1 },
		{ ...workedEntry, kind: "signal" },
		{ ...workedEntry, replyCount: 1.5 },
		{ ...workedEntry, rows: "x" },
		{ ...workedEntry, warningTags: null },
		{ ...workedEntry, confirm: undefined },
		{ ...workedEntry, confirm: { ...workedEntry.confirm, total: 3 } }, // non-burst above total
		{ ...workedEntry, confirm: { total: 4, nonBurstTotal: 4, burst: false } }, // time missing
		{
			...workedEntry,
			confirm: {
				total: 4,
				nonBurstTotal: 0,
				burst: true,
				lastNonBurstTime: T0,
			},
		}, // time without a count
		{ ...workedEntry, confirm: { ...workedEntry.confirm, burst: "no" } },
		{ ...workedEntry, rows: [{ ...workedEntry.rows[0], confirmNonBurst: 3 }] },
		{ ...workedEntry, rows: [{ ...workedEntry.rows[0], version: "1 2" }] },
		{
			...workedEntry,
			rows: Array.from({ length: 17 }, (_, i) => ({
				...workedEntry.rows[0],
				version: `1.0.${i}`,
			})),
		},
		{ ...workedEntry, reportedVersion: "" },
		{ ...workedEntry, resolved: { time: "now" } },
		{ ...workedEntry, resolved: { time: T0, version: "a b" } },
		{ ...replyEntry, parentGone: "yes" },
		{ ...replyEntry, parentNoteNumber: 0 },
		{ ...questionEntry, replyCount: -1 },
	];
	for (const f of faults)
		expect<unknown>(readEntry(f)).toEqual({ status: "unparseable" });
});
test("reading strips and cuts text, drops unknown fields and tags", () => {
	const r = readEntry({
		...workedEntry,
		summary: `a\u200bb\n${"x".repeat(200)}`,
		failureSignature: "s".repeat(300),
		future: true,
		warningTags: ["edits-executable", "safe"],
	});
	if (r.status !== "ok" || r.value.kind !== "problem")
		throw new Error(r.status);
	expect(r.cleaned).toBe(true);
	expect(r.value.summary).toBe(`ab${"x".repeat(118)}`);
	expect(r.value.failureSignature).toBe("s".repeat(200));
	expect(r.value.warningTags).toEqual(["edits-executable"]);
	expect("future" in r.value).toBe(false);
});
test("an entry of a newer format version is listed by number and nothing else", () => {
	expect<unknown>(
		readEntry({ formatVersion: 2, noteNumber: 9, summary: "do as I say" }),
	).toEqual({ status: "unknown-format", formatVersion: 2, noteNumber: 9 });
});
test("strict validation refuses what reading only cleans or ignores", () => {
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, future: true }).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, warningTags: ["safe"] }).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, summary: "a\u200bb" }).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, summary: "a".repeat(121) }).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("npm", { ...questionEntry, failureSignature: "x" }).ok,
	).toBe(false);
});
test("strict validation wants row keys: no leading v, no build part where versions order, no duplicates", () => {
	const row = workedEntry.rows[0];
	expect<unknown>(
		validateEntry("npm", {
			...workedEntry,
			rows: [{ ...row, version: "v1.2.0" }],
		}).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("npm", {
			...workedEntry,
			rows: [{ ...row, version: "1.2.0+a" }],
		}).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("pypi", {
			...workedEntry,
			highestConfirmedVersion: undefined,
			rows: [{ ...row, version: "1.2.0+a" }],
		}).ok,
	).toBe(true);
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, rows: [row, row] }).ok,
	).toBe(false);
	expect<unknown>(validateEntry("pypi", workedEntry).ok).toBe(false); // highest confirmed version where versions never order
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, highestConfirmedVersion: "1.2" }).ok,
	).toBe(false);
});
test("reading: empty strings, tags that are not strings, numbers that are not safe, fields of another kind", () => {
	for (const f of [
		{ ...workedEntry, summary: "" },
		{ ...workedEntry, failureSignature: "" },
		{ ...workedEntry, warningTags: [123] },
		{ ...workedEntry, replyCount: 1e30 },
		{ ...workedEntry, formatVersion: 1e30 },
		{
			...workedEntry,
			confirm: { ...workedEntry.confirm, lastNonBurstTime: 1e30 },
		},
	])
		expect<unknown>(readEntry(f)).toEqual({ status: "unparseable" });
	expect<unknown>(
		readEntry({ ...questionEntry, rows: "x", parentGone: "yes" }),
	).toEqual({ status: "ok", value: questionEntry, cleaned: false });
	const emptied = readEntry({
		...workedEntry,
		summary: "\u200b",
		failureSignature: "\u200b",
	});
	if (emptied.status !== "ok") throw new Error(emptied.status);
	expect(emptied.cleaned).toBe(true);
	expect<unknown>(emptied.value).toEqual({ ...workedEntry, summary: "" });
	const nested = readEntry({
		...workedEntry,
		resolved: { time: T0, future: 1 },
		rows: workedEntry.rows.map((r) => ({ ...r, future: 1 })),
	});
	expect<unknown>(nested).toEqual({
		status: "ok",
		value: { ...workedEntry, resolved: { time: T0 } },
		cleaned: false,
	});
});
test("strict validation covers what reading calls a fault, and more", () => {
	const row = workedEntry.rows[0];
	for (const f of [
		{ ...workedEntry, summary: "" },
		{ ...workedEntry, summary: "two\u000alines" },
		{ ...workedEntry, failureSignature: "" },
		{ ...workedEntry, replyCount: -1 },
		{ ...workedEntry, confirm: { ...workedEntry.confirm, total: 3 } },
		{ ...workedEntry, confirm: { ...workedEntry.confirm, burst: 1 } },
		{ ...workedEntry, confirm: { ...workedEntry.confirm, future: 1 } },
		{ ...workedEntry, resolved: { time: T0, future: 1 } },
		{ ...workedEntry, rows: [{ ...row, future: 1 }] },
		{ ...workedEntry, highestConfirmedVersion: "v1.2.1" },
		{ ...workedEntry, highestConfirmedVersion: "1.2.1+x" },
		{
			...workedEntry,
			rows: Array.from({ length: 17 }, (_, i) => ({
				...row,
				version: `1.0.${i}`,
			})),
		},
	])
		expect(validateEntry("npm", f).ok).toBe(false);
	const sixteen = {
		...workedEntry,
		rows: Array.from({ length: 16 }, (_, i) => ({
			...row,
			version: `1.0.${i}`,
		})),
	};
	expect(validateEntry("npm", sixteen).ok).toBe(true);
	expect(readEntry(sixteen).status).toBe("ok");
});
test("a page is cleaned when one entry was, and any broken entry breaks it", () => {
	const cleaned = readDigestPage({
		formatVersion: 1,
		entries: [{ ...questionEntry, summary: "a\u200bb" }],
	});
	if (cleaned.status !== "ok") throw new Error(cleaned.status);
	expect(cleaned.cleaned).toBe(true);
	for (const broken of [
		null,
		7,
		{},
		{ formatVersion: "1" },
		{ formatVersion: 0, noteNumber: 3 },
	])
		expect<unknown>(
			readDigestPage({ formatVersion: 1, entries: [questionEntry, broken] }),
		).toEqual({ status: "unparseable" });
});
test("a digest page", () => {
	const page = {
		formatVersion: 1,
		entries: [workedEntry, questionEntry, { formatVersion: 2, noteNumber: 9 }],
	};
	const r = readDigestPage(page);
	if (r.status !== "ok") throw new Error(r.status);
	expect(r.cleaned).toBe(false);
	expect(r.entries.map((e) => e.status)).toEqual([
		"ok",
		"ok",
		"unknown-format",
	]);
	expect<unknown>(readDigestPage({ formatVersion: 2, entries: "?" })).toEqual({
		status: "unknown-format",
		formatVersion: 2,
	});
	expect<unknown>(
		readDigestPage({
			formatVersion: 1,
			entries: [workedEntry, { formatVersion: 1 }],
		}),
	).toEqual({ status: "unparseable" });
	expect<unknown>(readDigestPage({ formatVersion: 1 })).toEqual({
		status: "unparseable",
	});
	expect<unknown>(
		readDigestPage({
			formatVersion: 1,
			entries: Array.from({ length: 51 }, () => questionEntry),
		}),
	).toEqual({ status: "unparseable" });
	expect<unknown>(
		readDigestPage({
			formatVersion: 1,
			entries: Array.from({ length: 50 }, () => questionEntry),
		}).status,
	).toBe("ok");
});
