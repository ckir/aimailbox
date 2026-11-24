import { expect, test } from "bun:test";
import { ECOSYSTEMS } from "./ecosystem.ts";
import { readEntry, validateEntry } from "./entry.ts";
import { problemEntry, T0 } from "./fixtures.ts";
import { LIMITS } from "./limits.ts";
import {
	type NoteContent,
	prepareDraft,
	readPublishedNote,
	validateWrite,
} from "./note.ts";
import { deriveStatus, type Vote } from "./status.ts";

// Each module must accept what the one before it produces: votes -> deriveStatus -> entry -> validate / read.
const VERSIONS = [
	"v",
	"vv1.2.3",
	"v1.2.3",
	"1.2.3",
	"1.2.3+b",
	"vvfoo",
	"1.0.0-rc.1",
	`1.0.0-${"a".repeat(58)}`,
];

function votesFor(burst: boolean): Vote[] {
	const votes: Vote[] = [];
	let t = 0;
	for (const version of VERSIONS) {
		for (const form of ["confirm", "doesNotReproduce"] as const) {
			votes.push({ form, version, arrivalTime: T0 + t++, isBurst: burst });
			votes.push({ form, version, arrivalTime: T0 + t++, isBurst: false });
		}
	}
	return votes;
}

test("every module accepts the previous one's output, for any version a vote may carry", () => {
	expect(VERSIONS[VERSIONS.length - 1]?.length).toBe(64);
	for (const ecosystem of ECOSYSTEMS) {
		for (const burst of [false, true]) {
			for (const maxRows of [16, 3]) {
				const votes = votesFor(burst);
				const entry = problemEntry({
					...deriveStatus(ecosystem, votes, maxRows),
				});
				const strict = validateEntry(ecosystem, entry);
				expect<unknown>(strict.ok).toBe(true);
				const wire = JSON.parse(JSON.stringify(entry));
				expect<unknown>(validateEntry(ecosystem, wire).ok).toBe(true);
				const read = readEntry(wire);
				expect(read.status).toBe("ok");
				if (read.status === "ok") expect(read.value).toEqual(entry);
				// one vote at a time too: a single odd version must never make the entry unreadable
				for (const vote of votes) {
					const one = problemEntry({ ...deriveStatus(ecosystem, [vote]) });
					expect<unknown>(validateEntry(ecosystem, one).ok).toBe(true);
					expect(readEntry(JSON.parse(JSON.stringify(one))).status).toBe("ok");
				}
			}
		}
	}
});

// Text with a two-byte and a four-byte character, cut to exactly `bytes` bytes
// (or `codePoints` code points) so that a field sits at its cap.
const MIXED = "\u00e9\u{1f600}";
const mixedBytes = (bytes: number) =>
	MIXED.repeat(Math.floor(bytes / 6)) + "a".repeat(bytes % 6);
const mixedCodePoints = (count: number) =>
	Array.from(MIXED.repeat(Math.ceil(count / 2)))
		.slice(0, count)
		.join("");
const SHORT = `ok ${MIXED}`;

test("a note written by a client survives prepare, validate and read, at the cap of each field", () => {
	const drafts: NoteContent[] = [];
	const summary = mixedCodePoints(LIMITS.summaryCodePoints);
	const problem = {
		formatVersion: 1,
		kind: "problem",
		summary: SHORT,
		whatWasDone: SHORT,
		whatHappened: SHORT,
		version: "1.2.3",
	} as const;
	drafts.push({ ...problem, summary });
	drafts.push({
		...problem,
		failureSignature: mixedBytes(LIMITS.failureSignatureBytes),
	});
	drafts.push({ ...problem, whatWasDone: mixedBytes(LIMITS.whatWasDoneBytes) });
	drafts.push({
		...problem,
		whatHappened: mixedBytes(LIMITS.whatHappenedBytes),
	});
	drafts.push({
		...problem,
		whatWasExpected: mixedBytes(LIMITS.whatWasExpectedBytes),
	});
	drafts.push({ ...problem, workaround: mixedBytes(LIMITS.workaroundBytes) });
	drafts.push({ ...problem, freeText: mixedBytes(LIMITS.freeTextBytes) });
	drafts.push({
		...problem,
		failureSignature: SHORT,
		whatWasExpected: SHORT,
		workaround: SHORT,
		freeText: SHORT,
	});
	const question = {
		formatVersion: 1,
		kind: "question",
		summary: SHORT,
		freeText: SHORT,
		version: "v2.0.0",
	} as const;
	drafts.push({ ...question, summary });
	drafts.push({ ...question, freeText: mixedBytes(LIMITS.freeTextBytes) });
	const reply = {
		formatVersion: 1,
		kind: "reply",
		summary: SHORT,
		freeText: SHORT,
		parentNoteNumber: 7,
	} as const;
	drafts.push({ ...reply, summary });
	drafts.push({ ...reply, freeText: mixedBytes(LIMITS.freeTextBytes) });

	for (const draft of drafts) {
		const prepared = prepareDraft(draft);
		expect<unknown>(prepared.ok).toBe(true);
		if (!prepared.ok) continue;
		expect<unknown>(prepared.value).toEqual(draft);
		const validated = validateWrite(prepared.value);
		expect<unknown>(validated.ok).toBe(true);
		if (!validated.ok) continue;
		expect<unknown>(validated.value).toEqual(prepared.value);
		const published = {
			...validated.value,
			noteNumber: 1,
			timeWritten: 1700000000,
			warningTags: [],
			...(draft.kind === "reply" ? { parentGone: false } : {}),
		};
		const read = readPublishedNote(JSON.parse(JSON.stringify(published)));
		expect<unknown>(read.status).toBe("ok");
		if (read.status !== "ok") continue;
		expect(read.cleaned).toBe(false);
		expect<unknown>(read.value).toEqual(published);
	}
	expect(drafts.length).toBe(12);
});
