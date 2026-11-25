import { foldText } from "./fold.ts";
import { LIMITS } from "./limits.ts";

export type ScanContext = {
	homeDirs: readonly string[]; // the home directory as given and resolved
	workDirs: readonly string[]; // the call directory, the workspace root, both as given and resolved
	userNames: readonly string[];
	hostNames: readonly string[];
	privateRemotes: readonly string[]; // each already reduced to canonical "host/path" (lower case)
	nonDefaultBranches: readonly string[];
	privatePackageNames: readonly string[];
	env: readonly { name: string; value: string }[]; // the process environment
};

export type ContextKind =
	| "home-dir"
	| "work-dir"
	| "user-name"
	| "host-name"
	| "private-remote"
	| "branch"
	| "private-package";

export type ContextFinding = {
	kind: ContextKind;
	/** UTF-16 code-unit indices into the scanned text, end exclusive; null when the hit was found only on the folded copy and has no place in the raw text. */
	span: { start: number; end: number } | null;
	fix?: string; // a fixed replacement, present only for a located home-dir ("~") or work-dir ("<workspace>")
};

export type ScanOutcome =
	| { outcome: "secret"; rules: string[] } // rule names only, sorted, no offsets, no matched text
	| { outcome: "context"; findings: ContextFinding[] } // located ones sorted by start, none overlapping, then the unlocated ones
	| { outcome: "clean" };

type PatternRule = { name: string; patterns: RegExp[] };

/** The pattern rules run on the exact text, with no folding. The env-value rule is not a pattern and is handled in `envValueMatches`. */
const PATTERN_RULES: readonly PatternRule[] = [
	{
		name: "private-key-block",
		patterns: [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/],
	},
	{ name: "aws-access-key-id", patterns: [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/] },
	{
		name: "github-token",
		patterns: [
			/\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
			/\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
		],
	},
	{ name: "slack-token", patterns: [/\bxox[abprs]-[A-Za-z0-9-]{10,}/] },
	{ name: "npm-token", patterns: [/\bnpm_[A-Za-z0-9]{36}\b/] },
	{
		name: "api-key-prefix",
		patterns: [
			/\bsk-[A-Za-z0-9_-]{20,}/,
			/\bsk_live_[A-Za-z0-9]{16,}/,
			/\bAIza[0-9A-Za-z_-]{35}\b/,
		],
	},
	{
		name: "jwt",
		patterns: [
			/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
		],
	},
	{
		name: "bearer-header",
		patterns: [
			/(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{16,}/i,
		],
	},
	{ name: "url-credentials", patterns: [/:\/\/[^/\s:@]+:[^/\s@]+@/] },
	{
		name: "secret-assignment",
		patterns: [
			/(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|secret[_-]?access[_-]?key)["']?\s*[:=]\s*["']?[^\s"']{12,}/i,
		],
	},
];

const ENV_VALUE_RULE = "env-value";

export const SECRET_RULES: readonly string[] = [
	...PATTERN_RULES.map((rule) => rule.name),
	ENV_VALUE_RULE,
];

const STANDARD_ENV = new Set([
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"PWD",
	"OLDPWD",
	"TERM",
	"TMPDIR",
	"LANG",
	"LANGUAGE",
	"EDITOR",
	"VISUAL",
	"PAGER",
	"DISPLAY",
	"HOSTNAME",
	"SSH_AUTH_SOCK",
]);

const SECRET_NAME_SEGMENTS = new Set([
	"SECRET",
	"TOKEN",
	"PASSWORD",
	"PASSWD",
	"PASSPHRASE",
	"CREDENTIAL",
	"CREDENTIALS",
	"AUTH",
	"KEY",
]);

function isStandardEnv(name: string): boolean {
	return (
		STANDARD_ENV.has(name) ||
		name.startsWith("LC_") ||
		name.startsWith("GIT_AUTHOR_") ||
		name.startsWith("GIT_COMMITTER_")
	);
}

/** A secret-named variable: a segment from the list, or the adjacent pair API KEY or PRIVATE KEY (whose KEY segment is already in the list). */
function isSecretNamed(name: string): boolean {
	const segments = name.toUpperCase().split("_");
	if (segments.some((segment) => SECRET_NAME_SEGMENTS.has(segment)))
		return true;
	for (let index = 0; index + 1 < segments.length; index += 1) {
		const pair = `${segments[index]}_${segments[index + 1]}`;
		if (pair === "API_KEY" || pair === "PRIVATE_KEY") return true;
	}
	return false;
}

/** Shannon entropy, in bits per code point. */
function entropyPerChar(value: string): number {
	const counts = new Map<string, number>();
	let total = 0;
	for (const char of value) {
		counts.set(char, (counts.get(char) ?? 0) + 1);
		total += 1;
	}
	if (total === 0) return 0;
	let bits = 0;
	for (const count of counts.values()) {
		const probability = count / total;
		bits -= probability * Math.log2(probability);
	}
	return bits;
}

function codePointCount(value: string): number {
	let count = 0;
	for (const _char of value) count += 1;
	return count;
}

function looksLikePathOrUrl(value: string): boolean {
	return (
		value.startsWith("/") ||
		value.startsWith("~/") ||
		/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)
	);
}

function envValueMatches(text: string, env: ScanContext["env"]): boolean {
	for (const { name, value } of env) {
		if (isStandardEnv(name)) continue;
		const length = codePointCount(value);
		const named =
			length >= LIMITS.scanEnvSecretNamedMinChars && isSecretNamed(name);
		const random =
			length >= LIMITS.scanEnvEntropyMinChars &&
			!looksLikePathOrUrl(value) &&
			entropyPerChar(value) >= LIMITS.scanEntropyBitsPerChar;
		if ((named || random) && text.includes(value)) return true;
	}
	return false;
}

/**
 * Lower-cases `text` one code point at a time and only where that keeps the
 * UTF-16 length, so every index into the result is an index into `text`.
 */
function lowerKeepingLength(text: string): string {
	let out = "";
	for (const char of text) {
		const lower = char.toLowerCase();
		out += lower.length === char.length ? lower : char;
	}
	return out;
}

/** Every start index at which `needle` occurs in `haystack`, overlapping hits included. */
function occurrences(haystack: string, needle: string): number[] {
	const starts: number[] = [];
	if (needle === "") return starts;
	let from = 0;
	while (from <= haystack.length - needle.length) {
		const at = haystack.indexOf(needle, from);
		if (at === -1) break;
		starts.push(at);
		from = at + 1;
	}
	return starts;
}

const WORD_CHAR = /[A-Za-z0-9_]/;
const PATH_WORD_CHAR = /[A-Za-z0-9_-]/;

function hasBoundaries(text: string, start: number, end: number): boolean {
	const before = start > 0 ? text.charAt(start - 1) : "";
	const after = end < text.length ? text.charAt(end) : "";
	return !WORD_CHAR.test(before) && !WORD_CHAR.test(after);
}

function boundedOccurrences(haystack: string, needle: string): number[] {
	return occurrences(haystack, needle).filter((start) =>
		hasBoundaries(haystack, start, start + needle.length),
	);
}

type Hit = {
	kind: ContextKind;
	start: number;
	end: number;
	fix?: string;
};

function pushHits(
	hits: Hit[],
	kind: ContextKind,
	starts: readonly number[],
	length: number,
	fix?: string,
): void {
	for (const start of starts) {
		const hit: Hit = { kind, start, end: start + length };
		if (fix !== undefined) hit.fix = fix;
		hits.push(hit);
	}
}

/** A directory hit ends at a path boundary: end of text, or neither a word character nor a dot that continues into one. */
function endsAtPathBoundary(text: string, end: number): boolean {
	if (end >= text.length) return true;
	const after = text.charAt(end);
	if (PATH_WORD_CHAR.test(after)) return false;
	if (after === "." && PATH_WORD_CHAR.test(text.charAt(end + 1))) return false;
	return true;
}

function directoryHits(
	text: string,
	entries: readonly string[],
	kind: "home-dir" | "work-dir",
	fix: string,
	hits: Hit[],
): void {
	for (const entry of new Set(entries)) {
		if (entry === "") continue;
		pushHits(
			hits,
			kind,
			occurrences(text, entry).filter((start) =>
				endsAtPathBoundary(text, start + entry.length),
			),
			entry.length,
			fix,
		);
	}
}

/** Names with a boundary on both sides: located on the raw text, then the extra look-alike hits on the folded copy, without a place. */
function nameHits(
	lowerText: string,
	foldedText: string,
	entries: readonly string[],
	kind: ContextKind,
	hits: Hit[],
	unlocated: ContextFinding[],
): void {
	for (const entry of new Set(entries)) {
		if (codePointCount(entry) < LIMITS.scanContextNameMinChars) continue;
		const lowerEntry = lowerKeepingLength(entry);
		const rawStarts = boundedOccurrences(lowerText, lowerEntry);
		pushHits(hits, kind, rawStarts, entry.length);
		const foldedEntry = foldText(entry);
		if (foldedEntry === "") continue;
		const foldedCount = boundedOccurrences(foldedText, foldedEntry).length;
		for (let extra = foldedCount - rawStarts.length; extra > 0; extra -= 1) {
			unlocated.push({ kind, span: null });
		}
	}
}

function remoteHits(
	lowerText: string,
	entries: readonly string[],
	hits: Hit[],
): void {
	for (const entry of new Set(entries)) {
		if (entry === "") continue;
		const forms = new Set([entry]);
		const slash = entry.indexOf("/");
		if (slash !== -1) {
			forms.add(`${entry.slice(0, slash)}:${entry.slice(slash + 1)}`);
		}
		for (const form of forms) {
			pushHits(
				hits,
				"private-remote",
				occurrences(lowerText, lowerKeepingLength(form)),
				form.length,
			);
		}
	}
}

function compareKind(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorted by start, longest first and then kind name at an equal start; a hit that begins before the previous kept hit ends is dropped. */
function resolveOverlaps(hits: Hit[]): Hit[] {
	const sorted = [...hits].sort(
		(a, b) =>
			a.start - b.start ||
			b.end - b.start - (a.end - a.start) ||
			compareKind(a.kind, b.kind),
	);
	const kept: Hit[] = [];
	for (const hit of sorted) {
		const previous = kept[kept.length - 1];
		if (previous !== undefined && hit.start < previous.end) {
			// A hit that reaches past the kept one means a fix would cut it in two: keep the finding, drop its fix.
			if (hit.end > previous.end) delete previous.fix;
			continue;
		}
		kept.push({ ...hit });
	}
	return kept;
}

function contextFindings(text: string, context: ScanContext): ContextFinding[] {
	const hits: Hit[] = [];
	const unlocated: ContextFinding[] = [];
	const lowerText = lowerKeepingLength(text);
	const foldedText = foldText(text);

	directoryHits(text, context.homeDirs, "home-dir", "~", hits);
	directoryHits(text, context.workDirs, "work-dir", "<workspace>", hits);
	for (const [entries, kind] of [
		[context.userNames, "user-name"],
		[context.hostNames, "host-name"],
		[context.nonDefaultBranches, "branch"],
		[context.privatePackageNames, "private-package"],
	] as const) {
		nameHits(lowerText, foldedText, entries, kind, hits, unlocated);
	}
	remoteHits(lowerText, context.privateRemotes, hits);

	const located: ContextFinding[] = resolveOverlaps(hits).map((hit) => {
		const finding: ContextFinding = {
			kind: hit.kind,
			span: { start: hit.start, end: hit.end },
		};
		if (hit.fix !== undefined) finding.fix = hit.fix;
		return finding;
	});
	unlocated.sort((a, b) => compareKind(a.kind, b.kind));
	return [...located, ...unlocated];
}

export function scanOutgoing(text: string, context: ScanContext): ScanOutcome {
	const rules = new Set<string>();
	for (const rule of PATTERN_RULES) {
		if (rule.patterns.some((pattern) => pattern.test(text))) {
			rules.add(rule.name);
		}
	}
	if (envValueMatches(text, context.env)) rules.add(ENV_VALUE_RULE);
	if (rules.size > 0) return { outcome: "secret", rules: [...rules].sort() };

	const findings = contextFindings(text, context);
	if (findings.length === 0) return { outcome: "clean" };
	return { outcome: "context", findings };
}

/** Applies every located finding that has a `fix`, right to left; the others are left in place. */
export function applyFixes(
	text: string,
	findings: readonly ContextFinding[],
): string {
	const fixable = findings
		.filter((finding) => finding.span !== null && finding.fix !== undefined)
		.sort((a, b) => (b.span?.start ?? 0) - (a.span?.start ?? 0));
	let out = text;
	let limit = text.length;
	for (const finding of fixable) {
		if (finding.span === null || finding.fix === undefined) continue;
		if (finding.span.end > limit) continue; // overlaps a fix already applied
		out =
			out.slice(0, finding.span.start) +
			finding.fix +
			out.slice(finding.span.end);
		limit = finding.span.start;
	}
	return out;
}

/** True when every finding has a fix, so that applyFixes leaves no context behind (8.1: "mechanical paths are offered a fixed redaction"). */
export function isMechanical(findings: readonly ContextFinding[]): boolean {
	return findings.every(
		(finding) => finding.span !== null && finding.fix !== undefined,
	);
}
