import { isCanonical } from "./address.ts";
import type { Entry } from "./entry.ts";
import { LIMITS, WARNING_TAGS } from "./limits.ts";
import type { LookupGroup } from "./lookup.ts";
import type { Mark } from "./mark.ts";
import type { Result } from "./result.ts";
import { computeTags } from "./tags.ts";
import { cutToBytes, cutToCodePoints, utf8Length } from "./text.ts";

export type EnvelopeError = "bad-boundary" | "boundary-in-text" | "bad-address";

const BOUNDARY = /^[0-9a-f]{32,64}$/;
const CUT_NOTICE = "[cut: over the size cap]";
const SEPARATOR = " | ";

/**
 * Wraps text that came from a note in an untrusted block (7.3). The boundary
 * must match /^[0-9a-f]{32,64}$/ (the client makes it from 16 to 32 random bytes
 * per call). A text over LIMITS.envelopeBytes is cut so that the kept text, one
 * line feed and the notice together are at most LIMITS.envelopeBytes bytes.
 */
export function wrapUntrusted(
	text: string,
	boundary: string,
): Result<string, EnvelopeError> {
	if (!BOUNDARY.test(boundary)) return { ok: false, error: "bad-boundary" };
	if (text.includes(boundary)) return { ok: false, error: "boundary-in-text" };
	let body = text;
	if (utf8Length(text) > LIMITS.envelopeBytes) {
		const allowance = LIMITS.envelopeBytes - utf8Length(CUT_NOTICE) - 1;
		body = `${cutToBytes(text, allowance)}\n${CUT_NOTICE}`;
	}
	return {
		ok: true,
		value: [
			`<<untrusted-begin boundary=${boundary}>>`,
			body,
			`<<untrusted-end boundary=${boundary}>>`,
		].join("\n"),
	};
}

/** One lookup line for one entry (7.2, 12.3). */
export function renderSummaryLine(entry: Entry, mark: Mark): string {
	const fields: string[] = [`#${entry.noteNumber}`, entry.kind];
	if (entry.kind === "reply") {
		fields.push(`answers-removed-#${entry.parentNoteNumber}`);
	} else {
		fields.push(mark);
	}
	if (entry.kind === "problem") {
		fields.push(
			`confirm=${entry.confirm.nonBurstTotal}`,
			`does-not-reproduce=${entry.doesNotReproduce.nonBurstTotal}`,
		);
		if (entry.confirm.burst) fields.push("burst-confirm");
		if (entry.doesNotReproduce.burst) fields.push("burst-does-not-reproduce");
	}
	if (entry.kind !== "reply") {
		fields.push(`replies=${entry.replyCount}`);
		if (entry.resolved !== undefined) {
			fields.push(
				entry.resolved.version === undefined
					? "resolved"
					: `resolved-from-${entry.resolved.version}`,
			);
		}
		const reported =
			entry.kind === "problem" ? entry.reportedVersion : entry.version;
		if (reported !== undefined) fields.push(`reported=${reported}`);
	}
	// 7.4: the client computes its own tags and accepts only known ones from the
	// service, so the line shows the union, each tag once, in vocabulary order.
	const ownTags = computeTags(
		entry.kind === "problem" && entry.failureSignature !== undefined
			? `${entry.summary}\n${entry.failureSignature}`
			: entry.summary,
	);
	const tags = WARNING_TAGS.filter(
		(tag) => entry.warningTags.includes(tag) || ownTags.includes(tag),
	);
	if (tags.length > 0) fields.push(`warn=${tags.join(",")}`);

	const prefix = `${fields.join(" ")}${SEPARATOR}`;
	const firstLine = entry.summary.split("\n")[0] ?? "";
	const summary = cutToBytes(
		cutToCodePoints(firstLine, LIMITS.summaryCodePoints),
		LIMITS.summaryLineBytes - utf8Length(prefix),
	);
	return `${prefix}${summary}`;
}

export type RenderOptions = {
	address: string; // canonical box address, printed in the header
	boundary: string; // see wrapUntrusted
	group: number; // 0-based index of this group, printed as group+1
	cleaned: boolean; // PageRead.cleaned of any page this group came from
	nextGroupCommand: string; // the exact command text for the next group; supplied by the client
};

/** One group of a lookup (7.2): everything that came from a note sits inside the one block. */
export function renderLookup(
	group: LookupGroup,
	options: RenderOptions,
): Result<string, EnvelopeError> {
	// The address is printed outside the untrusted block, so it must be canonical.
	if (!isCanonical(options.address)) return { ok: false, error: "bad-address" };
	const lines =
		group.shown.length === 0
			? ["(no entries)"]
			: group.shown.map(({ entry, mark }) => renderSummaryLine(entry, mark));
	const block = wrapUntrusted(lines.join("\n"), options.boundary);
	if (!block.ok) return block;

	const out: string[] = [
		`lookup ${options.address} group ${options.group + 1}: showing ${group.shown.length}`,
	];
	if (options.cleaned) {
		out.push(
			"notice: some content did not conform to the reading rules and was cleaned",
		);
	}
	out.push(block.value);
	if (group.notShown > 0) {
		out.push(
			`${group.notShown} more not shown; next group: ${options.nextGroupCommand}`,
		);
	}
	const unknown = group.unknownFormat;
	if (unknown.count > 0) {
		const lead = `${unknown.count} ${unknown.count === 1 ? "entry needs" : "entries need"} a newer client`;
		const listed = unknown.noteNumbers.map((n) => `#${n}`);
		if (listed.length === 0) {
			out.push(lead);
		} else {
			if (unknown.count > listed.length) listed.push("and others");
			out.push(`${lead}: ${listed.join(", ")}`);
		}
	}
	return { ok: true, value: out.join("\n") };
}
