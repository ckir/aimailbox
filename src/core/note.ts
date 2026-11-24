import type { WarningTag } from "./limits.ts";
import { FORMAT_VERSION, LIMITS, WARNING_TAGS } from "./limits.ts";
import type { ReadResult, Result } from "./result.ts";
import {
	codePointLength,
	cutToBytes,
	cutToCodePoints,
	isConforming,
	stripForbidden,
	utf8Length,
} from "./text.ts";
import { isValidVersion } from "./version.ts";

export type ProblemContent = {
	formatVersion: 1;
	kind: "problem";
	summary: string;
	whatWasDone: string;
	whatHappened: string;
	version?: string;
	whatWasExpected?: string;
	workaround?: string;
	failureSignature?: string;
	freeText?: string;
};
export type QuestionContent = {
	formatVersion: 1;
	kind: "question";
	summary: string;
	freeText: string;
	version?: string;
};
export type ReplyContent = {
	formatVersion: 1;
	kind: "reply";
	summary: string;
	parentNoteNumber: number;
	freeText: string;
};
export type NoteContent = ProblemContent | QuestionContent | ReplyContent;
type PublishedMeta = {
	noteNumber: number;
	timeWritten: number;
	warningTags: WarningTag[];
};
export type PublishedNote =
	| (ProblemContent & PublishedMeta)
	| (QuestionContent & PublishedMeta)
	| (ReplyContent & PublishedMeta & { parentGone: boolean }); // required on a reply; an unknown field on the other kinds

export type NoteError =
	| "not-an-object"
	| "unknown-format"
	| "unknown-field"
	| "bad-kind"
	| "missing-field"
	| "bad-type"
	| "bad-number"
	| "bad-version"
	| "not-conforming"
	| "too-long";

export const TEXT_FIELD_ORDER = [
	"summary",
	"failureSignature",
	"whatWasDone",
	"whatHappened",
	"whatWasExpected",
	"workaround",
	"freeText",
] as const;
type TextField = (typeof TEXT_FIELD_ORDER)[number];
type Cap = { bytes: number } | { codePoints: number };

const CAPS: Record<TextField, Cap> = {
	summary: { codePoints: LIMITS.summaryCodePoints },
	failureSignature: { bytes: LIMITS.failureSignatureBytes },
	whatWasDone: { bytes: LIMITS.whatWasDoneBytes },
	whatHappened: { bytes: LIMITS.whatHappenedBytes },
	whatWasExpected: { bytes: LIMITS.whatWasExpectedBytes },
	workaround: { bytes: LIMITS.workaroundBytes },
	freeText: { bytes: LIMITS.freeTextBytes },
};

type Shape = {
	required: readonly TextField[];
	optional: readonly TextField[];
	hasVersion: boolean;
	hasParent: boolean;
};
const SHAPES: Record<NoteContent["kind"], Shape> = {
	problem: {
		required: ["summary", "whatWasDone", "whatHappened"],
		optional: ["failureSignature", "whatWasExpected", "workaround", "freeText"],
		hasVersion: true,
		hasParent: false,
	},
	question: {
		required: ["summary", "freeText"],
		optional: [],
		hasVersion: true,
		hasParent: false,
	},
	reply: {
		required: ["summary", "freeText"],
		optional: [],
		hasVersion: false,
		hasParent: true,
	},
};

export function isPlainObject(
	value: unknown,
): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

export function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 1;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Strips forbidden characters, optionally removes line feeds, then cuts to the cap. */
export function cleanText(
	text: string,
	cap: Cap,
	singleLine: boolean,
): { text: string; changed: boolean } {
	let out = stripForbidden(text);
	if (singleLine) out = out.replaceAll("\n", "");
	out =
		"bytes" in cap
			? cutToBytes(out, cap.bytes)
			: cutToCodePoints(out, cap.codePoints);
	return { text: out, changed: out !== text };
}

function kindShape(kind: unknown): Shape | undefined {
	return typeof kind === "string" && Object.hasOwn(SHAPES, kind)
		? SHAPES[kind as NoteContent["kind"]]
		: undefined;
}

/** A property whose value is undefined is absent. */
function field(obj: Record<string, unknown>, key: string): unknown {
	return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function validate(value: unknown): Result<NoteContent, NoteError> {
	const fail = (error: NoteError) => ({ ok: false, error }) as const;
	if (!isPlainObject(value)) return fail("not-an-object");
	if (field(value, "formatVersion") !== FORMAT_VERSION)
		return fail("unknown-format");
	const shape = kindShape(field(value, "kind"));
	if (shape === undefined) return fail("bad-kind");

	const textFields = [...shape.required, ...shape.optional];
	const allowed = new Set<string>(["formatVersion", "kind", ...textFields]);
	if (shape.hasVersion) allowed.add("version");
	if (shape.hasParent) allowed.add("parentNoteNumber");
	const present = Object.keys(value).filter((k) => value[k] !== undefined);
	if (present.some((k) => !allowed.has(k))) return fail("unknown-field");

	const required: string[] = [...shape.required];
	if (shape.hasParent) required.push("parentNoteNumber");
	if (required.some((k) => field(value, k) === undefined))
		return fail("missing-field");

	const texts: [TextField, string][] = [];
	for (const key of textFields) {
		const v = field(value, key);
		if (v === undefined) continue;
		if (typeof v !== "string" || v === "") return fail("bad-type");
		texts.push([key, v]);
	}
	if (shape.hasParent && !isPositiveSafeInteger(value.parentNoteNumber))
		return fail("bad-number");
	const version = field(value, "version");
	if (
		shape.hasVersion &&
		version !== undefined &&
		(typeof version !== "string" || version === "" || !isValidVersion(version))
	)
		return fail("bad-version");

	for (const [key, text] of texts) {
		if (!isConforming(text) || (key === "summary" && text.includes("\n")))
			return fail("not-conforming");
	}
	let total = 0;
	for (const [key, text] of texts) {
		const cap = CAPS[key];
		if (
			"bytes" in cap
				? utf8Length(text) > cap.bytes
				: codePointLength(text) > cap.codePoints
		)
			return fail("too-long");
		total += utf8Length(text);
	}
	if (total > LIMITS.noteTextBytes) return fail("too-long");

	const copy: Record<string, unknown> = {};
	for (const key of present) copy[key] = value[key];
	return { ok: true, value: copy as NoteContent };
}

/** Client, before the scan (7.1 first rule): strips forbidden characters, never cuts. */
export function prepareDraft(input: unknown): Result<NoteContent, NoteError> {
	if (!isPlainObject(input)) return validate(input);
	const copy: Record<string, unknown> = { ...input };
	for (const key of TEXT_FIELD_ORDER) {
		const v = field(copy, key);
		if (typeof v === "string") copy[key] = stripForbidden(v);
	}
	return validate(copy);
}

/** Service (7.1 second rule): accept unchanged or reject. */
export function validateWrite(value: unknown): Result<NoteContent, NoteError> {
	return validate(value);
}

/** Client on reading (7.1 third rule): lenient, cleans under a notice. */
export function readPublishedNote(value: unknown): ReadResult<PublishedNote> {
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

	const kind = field(value, "kind");
	const shape = kindShape(kind);
	if (shape === undefined) return unparseable;
	const noteNumber = field(value, "noteNumber");
	const timeWritten = field(value, "timeWritten");
	if (!isPositiveSafeInteger(noteNumber)) return unparseable;
	if (!isNonNegativeSafeInteger(timeWritten)) return unparseable;
	const tags = field(value, "warningTags");
	if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))
		return unparseable;

	const out: Record<string, unknown> = { formatVersion: 1, kind };
	const raw: [TextField, string][] = [];
	for (const key of TEXT_FIELD_ORDER) {
		const isRequired = shape.required.includes(key);
		if (!isRequired && !shape.optional.includes(key)) continue;
		const v = field(value, key);
		if (v === undefined) {
			if (isRequired) return unparseable;
			continue;
		}
		if (typeof v !== "string" || v === "") return unparseable;
		raw.push([key, v]);
	}
	if (shape.hasParent) {
		const parent = field(value, "parentNoteNumber");
		if (!isPositiveSafeInteger(parent)) return unparseable;
		out.parentNoteNumber = parent;
		const gone = field(value, "parentGone");
		if (typeof gone !== "boolean") return unparseable;
		out.parentGone = gone;
	}
	if (shape.hasVersion) {
		const version = field(value, "version");
		if (version !== undefined) {
			if (typeof version !== "string" || !isValidVersion(version))
				return unparseable;
			out.version = version;
		}
	}

	let cleaned = false;
	let remaining = LIMITS.noteTextBytes;
	for (const [key, original] of raw) {
		const first = cleanText(original, CAPS[key], key === "summary");
		let text = first.text;
		let changed = first.changed;
		if (utf8Length(text) > remaining) {
			text = cutToBytes(text, remaining);
			changed = true;
		}
		remaining -= utf8Length(text);
		if (changed) cleaned = true;
		if (text === "" && !shape.required.includes(key)) continue;
		out[key] = text;
	}

	out.noteNumber = noteNumber;
	out.timeWritten = timeWritten;
	out.warningTags = tags.filter((t): t is WarningTag =>
		(WARNING_TAGS as readonly string[]).includes(t),
	);
	return { status: "ok", value: out as PublishedNote, cleaned };
}
