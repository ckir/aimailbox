import type { Ecosystem } from "./ecosystem.ts";
import type { WarningTag } from "./limits.ts";
import { FORMAT_VERSION, LIMITS, WARNING_TAGS } from "./limits.ts";
import {
	cleanText,
	isNonNegativeSafeInteger,
	isPlainObject,
	isPositiveSafeInteger,
} from "./note.ts";
import type { ReadResult, Result } from "./result.ts";
import { canOrder, isValidVersion, rowKey, rowVersion } from "./version.ts";

export type FormCounts = {
	total: number;
	nonBurstTotal: number;
	burst: boolean;
	lastNonBurstTime?: number;
};
export type VersionRow = {
	version: string;
	confirmTotal: number;
	confirmNonBurst: number;
	doesNotReproduceTotal: number;
	doesNotReproduceNonBurst: number;
};
export type Resolved = { time: number; version?: string };
type EntryBase = {
	formatVersion: 1;
	noteNumber: number;
	timeWritten: number;
	summary: string;
	warningTags: WarningTag[];
};
export type ProblemEntry = EntryBase & {
	kind: "problem";
	replyCount: number;
	resolved?: Resolved;
	failureSignature?: string;
	reportedVersion?: string;
	authorObservedVersion?: string;
	confirm: FormCounts;
	doesNotReproduce: FormCounts;
	rows: VersionRow[];
	highestConfirmedVersion?: string;
};
export type QuestionEntry = EntryBase & {
	kind: "question";
	replyCount: number;
	resolved?: Resolved;
	version?: string;
};
export type ReplyEntry = EntryBase & {
	kind: "reply";
	parentNoteNumber: number;
	parentGone: boolean;
};
export type Entry = ProblemEntry | QuestionEntry | ReplyEntry;

export type PageEntry = Exclude<ReadResult<Entry>, { status: "unparseable" }>;
export type PageRead =
	| { status: "ok"; entries: PageEntry[]; cleaned: boolean }
	| { status: "unknown-format"; formatVersion: number }
	| { status: "unparseable" };

type Obj = Record<string, unknown>;

const BASE_FIELDS = [
	"formatVersion",
	"noteNumber",
	"kind",
	"timeWritten",
	"summary",
	"warningTags",
] as const;
const KIND_FIELDS: Record<Entry["kind"], readonly string[]> = {
	problem: [
		...BASE_FIELDS,
		"replyCount",
		"resolved",
		"failureSignature",
		"reportedVersion",
		"authorObservedVersion",
		"confirm",
		"doesNotReproduce",
		"rows",
		"highestConfirmedVersion",
	],
	question: [...BASE_FIELDS, "replyCount", "resolved", "version"],
	reply: [...BASE_FIELDS, "parentNoteNumber", "parentGone"],
};
const RESOLVED_FIELDS = ["time", "version"];
const FORM_FIELDS = ["total", "nonBurstTotal", "burst", "lastNonBurstTime"];
const ROW_FIELDS = [
	"version",
	"confirmTotal",
	"confirmNonBurst",
	"doesNotReproduceTotal",
	"doesNotReproduceNonBurst",
];

// Internal control flow only: thrown inside this file, caught at the two entry points.
class Fault {
	constructor(readonly code: string) {}
}

/** A property whose value is undefined is absent. */
function field(obj: Obj, key: string): unknown {
	return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/** Strict mode only: a field that is not in the list is a fault. */
function noUnknown(obj: Obj, allowed: readonly string[], strict: boolean) {
	if (
		strict &&
		Object.keys(obj).some((k) => obj[k] !== undefined && !allowed.includes(k))
	)
		throw new Fault("unknown-field");
}

function count(obj: Obj, key: string): number {
	const v = field(obj, key);
	if (!isNonNegativeSafeInteger(v)) throw new Fault("bad-number");
	return v;
}

function version(obj: Obj, key: string): string | undefined {
	const v = field(obj, key);
	if (v === undefined) return undefined;
	if (typeof v !== "string" || !isValidVersion(v))
		throw new Fault("bad-version");
	return v;
}

function parseResolved(raw: unknown, strict: boolean): Resolved {
	if (!isPlainObject(raw)) throw new Fault("bad-type");
	noUnknown(raw, RESOLVED_FIELDS, strict);
	const time = count(raw, "time");
	const v = version(raw, "version");
	return v === undefined ? { time } : { time, version: v };
}

function parseForm(raw: unknown, strict: boolean): FormCounts {
	if (!isPlainObject(raw)) throw new Fault("bad-type");
	noUnknown(raw, FORM_FIELDS, strict);
	const total = count(raw, "total");
	const nonBurstTotal = count(raw, "nonBurstTotal");
	const burst = field(raw, "burst");
	if (typeof burst !== "boolean") throw new Fault("bad-type");
	if (nonBurstTotal > total) throw new Fault("bad-number");
	// 12.3: the burst flag is set exactly while some current vote is a burst arrival.
	if (burst !== total > nonBurstTotal) throw new Fault("bad-number");
	const last = field(raw, "lastNonBurstTime");
	if (nonBurstTotal === 0) {
		if (last !== undefined) throw new Fault("bad-number");
		return { total, nonBurstTotal, burst };
	}
	return {
		total,
		nonBurstTotal,
		burst,
		lastNonBurstTime: count(raw, "lastNonBurstTime"),
	};
}

function parseRows(
	raw: unknown,
	strict: boolean,
	ecosystem: Ecosystem | undefined,
): VersionRow[] {
	if (!Array.isArray(raw) || raw.length > LIMITS.versionRows)
		throw new Fault("bad-rows");
	const keys = new Set<string>();
	const rows: VersionRow[] = [];
	for (let i = 0; i < raw.length; i++) {
		const r: unknown = raw[i];
		if (!isPlainObject(r)) throw new Fault("bad-type");
		noUnknown(r, ROW_FIELDS, strict);
		const v = field(r, "version");
		if (typeof v !== "string" || !isValidVersion(v))
			throw new Fault("bad-version");
		const row = {
			version: v,
			confirmTotal: count(r, "confirmTotal"),
			confirmNonBurst: count(r, "confirmNonBurst"),
			doesNotReproduceTotal: count(r, "doesNotReproduceTotal"),
			doesNotReproduceNonBurst: count(r, "doesNotReproduceNonBurst"),
		};
		if (
			row.confirmNonBurst > row.confirmTotal ||
			row.doesNotReproduceNonBurst > row.doesNotReproduceTotal
		)
			throw new Fault("bad-number");
		if (ecosystem !== undefined) {
			// 12.3: the service leaves out versions with no current vote.
			if (row.confirmTotal === 0 && row.doesNotReproduceTotal === 0)
				throw new Fault("empty-row");
			if (rowVersion(ecosystem, v) !== v) throw new Fault("bad-row-key");
			const key = rowKey(ecosystem, v);
			if (keys.has(key)) throw new Fault("duplicate-row");
			keys.add(key);
		}
		rows.push(row);
	}
	return rows;
}

function parseTags(raw: unknown, strict: boolean): WarningTag[] {
	if (!Array.isArray(raw) || raw.some((t) => typeof t !== "string"))
		throw new Fault("bad-type");
	const known = (t: string): t is WarningTag =>
		(WARNING_TAGS as readonly string[]).includes(t);
	const present = (raw as string[]).filter(known);
	if (strict && present.length !== raw.length) throw new Fault("unknown-tag");
	// Lenient: the first occurrence of each known tag is kept, later ones dropped.
	const tags = [...new Set(present)];
	if (strict && tags.length !== present.length) throw new Fault("bad-tags");
	return tags;
}

type Cleaner = { cleaned: boolean };

/** Present text is a non-empty string; cleaned (lenient) or required to be clean already (strict). */
function text(
	obj: Obj,
	key: string,
	cap: { bytes: number } | { codePoints: number },
	singleLine: boolean,
	strict: boolean,
	state: Cleaner,
): string | undefined {
	const v = field(obj, key);
	if (v === undefined) return undefined;
	if (typeof v !== "string" || v === "") throw new Fault("bad-type");
	const out = cleanText(v, cap, singleLine);
	if (out.changed) {
		if (strict) throw new Fault("not-clean");
		state.cleaned = true;
	}
	return out.text;
}

function parseVersionOne(
	value: Obj,
	ecosystem: Ecosystem | undefined,
): { entry: Entry; cleaned: boolean } {
	const strict = ecosystem !== undefined;
	const kind = field(value, "kind");
	if (typeof kind !== "string" || !Object.hasOwn(KIND_FIELDS, kind))
		throw new Fault("bad-kind");
	const k = kind as Entry["kind"];
	noUnknown(value, KIND_FIELDS[k], strict);

	const noteNumber = field(value, "noteNumber");
	if (!isPositiveSafeInteger(noteNumber)) throw new Fault("bad-number");
	const timeWritten = count(value, "timeWritten");
	const state: Cleaner = { cleaned: false };
	const summary = text(
		value,
		"summary",
		{ codePoints: LIMITS.summaryCodePoints },
		true,
		strict,
		state,
	);
	if (summary === undefined) throw new Fault("missing-field");
	const warningTags = parseTags(field(value, "warningTags"), strict);
	const base = {
		formatVersion: FORMAT_VERSION,
		noteNumber,
		timeWritten,
		summary,
		warningTags,
	} as const;

	if (k === "reply") {
		const parentNoteNumber = field(value, "parentNoteNumber");
		if (!isPositiveSafeInteger(parentNoteNumber)) throw new Fault("bad-number");
		const parentGone = field(value, "parentGone");
		if (typeof parentGone !== "boolean") throw new Fault("bad-type");
		return {
			entry: { ...base, kind: "reply", parentNoteNumber, parentGone },
			cleaned: state.cleaned,
		};
	}

	const replyCount = count(value, "replyCount");
	const rawResolved = field(value, "resolved");
	const resolved =
		rawResolved === undefined ? undefined : parseResolved(rawResolved, strict);

	if (k === "question") {
		const v = version(value, "version");
		const entry: QuestionEntry = { ...base, kind: "question", replyCount };
		if (resolved !== undefined) entry.resolved = resolved;
		if (v !== undefined) entry.version = v;
		return { entry, cleaned: state.cleaned };
	}

	const failureSignature = text(
		value,
		"failureSignature",
		{ bytes: LIMITS.failureSignatureBytes },
		false,
		strict,
		state,
	);
	const reportedVersion = version(value, "reportedVersion");
	const authorObservedVersion = version(value, "authorObservedVersion");
	const confirm = parseForm(field(value, "confirm"), strict);
	const doesNotReproduce = parseForm(field(value, "doesNotReproduce"), strict);
	const rows = parseRows(field(value, "rows"), strict, ecosystem);
	const highest = version(value, "highestConfirmedVersion");
	if (
		ecosystem !== undefined &&
		highest !== undefined &&
		(!canOrder(ecosystem, highest) || rowKey(ecosystem, highest) !== highest)
	)
		throw new Fault("bad-highest-version");

	const entry: ProblemEntry = {
		...base,
		kind: "problem",
		replyCount,
		confirm,
		doesNotReproduce,
		rows,
	};
	if (resolved !== undefined) entry.resolved = resolved;
	if (failureSignature !== undefined && failureSignature !== "")
		entry.failureSignature = failureSignature;
	if (reportedVersion !== undefined) entry.reportedVersion = reportedVersion;
	if (authorObservedVersion !== undefined)
		entry.authorObservedVersion = authorObservedVersion;
	if (highest !== undefined) entry.highestConfirmedVersion = highest;
	return { entry, cleaned: state.cleaned };
}

function run<T>(body: () => T): T | Fault {
	try {
		return body();
	} catch (e) {
		if (e instanceof Fault) return e;
		throw e;
	}
}

/** Service self-check before publishing: accept the entry exactly as it is, or refuse. */
export function validateEntry(
	ecosystem: Ecosystem,
	value: unknown,
): Result<Entry, string> {
	if (!isPlainObject(value)) return { ok: false, error: "not-an-object" };
	if (field(value, "formatVersion") !== FORMAT_VERSION)
		return { ok: false, error: "unknown-format" };
	const r = run(() => parseVersionOne(value, ecosystem));
	return r instanceof Fault
		? { ok: false, error: r.code }
		: { ok: true, value: r.entry };
}

/** Client on reading: lenient, cleans under a notice. */
export function readEntry(value: unknown): ReadResult<Entry> {
	const unparseable = { status: "unparseable" } as const;
	if (!isPlainObject(value)) return unparseable;
	const formatVersion = field(value, "formatVersion");
	if (!isPositiveSafeInteger(formatVersion)) return unparseable;
	if (formatVersion > FORMAT_VERSION) {
		const noteNumber = field(value, "noteNumber");
		return isPositiveSafeInteger(noteNumber)
			? { status: "unknown-format", formatVersion, noteNumber }
			: { status: "unknown-format", formatVersion };
	}
	const r = run(() => parseVersionOne(value, undefined));
	return r instanceof Fault
		? unparseable
		: { status: "ok", value: r.entry, cleaned: r.cleaned };
}

export function readDigestPage(value: unknown): PageRead {
	const unparseable = { status: "unparseable" } as const;
	if (!isPlainObject(value)) return unparseable;
	const formatVersion = field(value, "formatVersion");
	if (!isPositiveSafeInteger(formatVersion)) return unparseable;
	if (formatVersion > FORMAT_VERSION)
		return { status: "unknown-format", formatVersion };
	const raw = field(value, "entries");
	if (!Array.isArray(raw) || raw.length > LIMITS.entriesPerDigestPage)
		return unparseable;
	const entries: PageEntry[] = [];
	let cleaned = false;
	for (let i = 0; i < raw.length; i++) {
		const r = readEntry(raw[i]);
		if (r.status === "unparseable") return unparseable;
		if (r.status === "ok" && r.cleaned) cleaned = true;
		entries.push(r);
	}
	return { status: "ok", entries, cleaned };
}
