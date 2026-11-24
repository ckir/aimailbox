import type { Ecosystem } from "./ecosystem.ts";
import { ordersVersions } from "./ecosystem.ts";
import { LIMITS } from "./limits.ts";
import type { Result } from "./result.ts";

const VERSION_CHARS = /^[A-Za-z0-9.\-+_~:!]+$/;
const NUMERIC = /^(?:0|[1-9][0-9]*)$/;
const ALL_DIGITS = /^[0-9]+$/;
const PRERELEASE_ID = /^(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)$/;
const BUILD_ID = /^[0-9A-Za-z-]+$/;

type Parsed = {
	core: readonly [string, string, string];
	prerelease: readonly string[];
};

/** 12.1: 1..LIMITS.versionChars characters of [A-Za-z0-9.\-+_~:!]. */
export function isValidVersion(text: string): boolean {
	return text.length <= LIMITS.versionChars && VERSION_CHARS.test(text);
}

/** Removes exactly one leading "v", if present. */
export function stripLeadingV(version: string): string {
	return version.startsWith("v") ? version.slice(1) : version;
}

// Strict Semantic Versioning 2.0.0 (the semver.md BNF); undefined when the text does not match.
function parseStrict(text: string): Parsed | undefined {
	const plus = text.indexOf("+");
	const beforeBuild = plus === -1 ? text : text.slice(0, plus);
	if (plus !== -1) {
		for (const id of text.slice(plus + 1).split(".")) {
			if (!BUILD_ID.test(id)) return undefined;
		}
	}
	const dash = beforeBuild.indexOf("-");
	const coreText = dash === -1 ? beforeBuild : beforeBuild.slice(0, dash);
	const prerelease = dash === -1 ? [] : beforeBuild.slice(dash + 1).split(".");
	for (const id of prerelease) {
		if (!PRERELEASE_ID.test(id)) return undefined;
	}
	const parts = coreText.split(".");
	const [major, minor, patch] = parts;
	if (
		parts.length !== 3 ||
		major === undefined ||
		minor === undefined ||
		patch === undefined ||
		!NUMERIC.test(major) ||
		!NUMERIC.test(minor) ||
		!NUMERIC.test(patch)
	) {
		return undefined;
	}
	return { core: [major, minor, patch], prerelease };
}

/** Ordering needs an ecosystem that orders versions, a valid version and strict SemVer after one "v". */
export function canOrder(ecosystem: Ecosystem, version: string): boolean {
	return (
		ordersVersions(ecosystem) &&
		isValidVersion(version) &&
		parseStrict(stripLeadingV(version)) !== undefined
	);
}

function compareText(a: string, b: string): -1 | 0 | 1 {
	return a < b ? -1 : a > b ? 1 : 0;
}

// Numeric identifiers without a leading zero: longer is larger, equal lengths compare as text.
function compareNumeric(a: string, b: string): -1 | 0 | 1 {
	if (a.length !== b.length) return a.length < b.length ? -1 : 1;
	return compareText(a, b);
}

function comparePrereleaseId(a: string, b: string): -1 | 0 | 1 {
	const aNumeric = ALL_DIGITS.test(a);
	const bNumeric = ALL_DIGITS.test(b);
	if (aNumeric && bNumeric) return compareNumeric(a, b);
	if (aNumeric) return -1;
	if (bNumeric) return 1;
	return compareText(a, b);
}

function compareParsed(a: Parsed, b: Parsed): -1 | 0 | 1 {
	for (let i = 0; i < 3; i++) {
		const order = compareNumeric(a.core[i] as string, b.core[i] as string);
		if (order !== 0) return order;
	}
	if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
	if (a.prerelease.length === 0) return 1;
	if (b.prerelease.length === 0) return -1;
	const shared = Math.min(a.prerelease.length, b.prerelease.length);
	for (let i = 0; i < shared; i++) {
		const order = comparePrereleaseId(
			a.prerelease[i] as string,
			b.prerelease[i] as string,
		);
		if (order !== 0) return order;
	}
	if (a.prerelease.length === b.prerelease.length) return 0;
	return a.prerelease.length < b.prerelease.length ? -1 : 1;
}

/** Semantic Versioning precedence; undefined unless both versions can be ordered. */
export function compareVersions(
	ecosystem: Ecosystem,
	a: string,
	b: string,
): -1 | 0 | 1 | undefined {
	if (!canOrder(ecosystem, a) || !canOrder(ecosystem, b)) return undefined;
	const parsedA = parseStrict(stripLeadingV(a));
	const parsedB = parseStrict(stripLeadingV(b));
	if (parsedA === undefined || parsedB === undefined) return undefined;
	return compareParsed(parsedA, parsedB);
}

export function versionsEqual(
	ecosystem: Ecosystem,
	a: string,
	b: string,
): boolean {
	if (canOrder(ecosystem, a) && canOrder(ecosystem, b)) {
		return compareVersions(ecosystem, a, b) === 0;
	}
	return stripLeadingV(a) === stripLeadingV(b);
}

/** One leading "v" removed; where versions order, the "+build" part is removed too. */
export function rowKey(ecosystem: Ecosystem, version: string): string {
	const stripped = stripLeadingV(version);
	if (!canOrder(ecosystem, version)) return stripped;
	const plus = stripped.indexOf("+");
	return plus === -1 ? stripped : stripped.slice(0, plus);
}

/**
 * The version a table row carries: the row key when that key is itself a valid
 * 12.1 version that rowKey leaves unchanged, otherwise the version exactly as written.
 */
export function rowVersion(ecosystem: Ecosystem, version: string): string {
	const key = rowKey(ecosystem, version);
	return isValidVersion(key) && rowKey(ecosystem, key) === key ? key : version;
}

export function resolveInstalled(
	ecosystem: Ecosystem,
	explicit: string | undefined,
	recorded: readonly string[],
): Result<string | undefined, "invalid-version"> {
	if (explicit !== undefined) {
		return isValidVersion(explicit)
			? { ok: true, value: explicit }
			: { ok: false, error: "invalid-version" };
	}
	if (ecosystem === "tool") return { ok: true, value: undefined };
	if (!recorded.every(isValidVersion)) return { ok: true, value: undefined };
	const groups: string[] = []; // the first member of each group of equal versions
	for (const version of recorded) {
		if (!groups.some((first) => versionsEqual(ecosystem, first, version))) {
			groups.push(version);
		}
	}
	return { ok: true, value: groups.length === 1 ? groups[0] : undefined };
}
