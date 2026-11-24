import type { Ecosystem } from "./ecosystem.ts";
import { ordersVersions } from "./ecosystem.ts";
import type { Entry, ProblemEntry, QuestionEntry } from "./entry.ts";
import { LIMITS } from "./limits.ts";
import { canOrder, compareVersions, versionsEqual } from "./version.ts";

export type Mark =
	| "resolved"
	| "not-reproduced-on-newer"
	| "disputed-on-your-version"
	| "same-version"
	| "unknown";

function isResolvedForYou(
	ecosystem: Ecosystem,
	entry: ProblemEntry | QuestionEntry,
	installed: string | undefined,
): boolean {
	const resolved = entry.resolved;
	if (resolved === undefined) return false;
	if (
		entry.kind === "problem" &&
		entry.confirm.lastNonBurstTime !== undefined &&
		entry.confirm.lastNonBurstTime > resolved.time
	) {
		return false;
	}
	if (resolved.version === undefined) return true;
	if (installed === undefined) return false;
	if (versionsEqual(ecosystem, installed, resolved.version)) return true;
	return (
		canOrder(ecosystem, installed) &&
		canOrder(ecosystem, resolved.version) &&
		(compareVersions(ecosystem, installed, resolved.version) ?? -1) >= 0
	);
}

/** The highest of the reported, author-observed and highest confirmed versions that can be ordered. */
function highestAffected(
	ecosystem: Ecosystem,
	entry: ProblemEntry,
): string | undefined {
	let highest: string | undefined;
	for (const v of [
		entry.reportedVersion,
		entry.authorObservedVersion,
		entry.highestConfirmedVersion,
	]) {
		if (v === undefined || !canOrder(ecosystem, v)) continue;
		if (highest === undefined || compareVersions(ecosystem, v, highest) === 1) {
			highest = v;
		}
	}
	return highest;
}

function isNotReproducedOnNewer(
	ecosystem: Ecosystem,
	entry: ProblemEntry,
	installed: string | undefined,
	threshold: number,
): boolean {
	if (!ordersVersions(ecosystem)) return false;
	if (installed === undefined || !canOrder(ecosystem, installed)) return false;
	const affected = highestAffected(ecosystem, entry);
	if (affected === undefined) return false;
	if (compareVersions(ecosystem, installed, affected) !== 1) return false;
	let sum = 0;
	for (const row of entry.rows) {
		if (!canOrder(ecosystem, row.version)) continue;
		if (
			compareVersions(ecosystem, row.version, affected) === 1 &&
			(compareVersions(ecosystem, row.version, installed) ?? 1) <= 0
		) {
			sum += row.doesNotReproduceNonBurst;
		}
	}
	return sum >= threshold;
}

function isDisputedOnYourVersion(
	ecosystem: Ecosystem,
	entry: ProblemEntry,
	installed: string | undefined,
): boolean {
	if (installed === undefined) return false;
	return entry.rows.some(
		(row) =>
			versionsEqual(ecosystem, row.version, installed) &&
			row.doesNotReproduceNonBurst > row.confirmNonBurst,
	);
}

function isSameVersion(
	ecosystem: Ecosystem,
	entry: Entry,
	installed: string | undefined,
): boolean {
	if (installed === undefined) return false;
	const same = (v: string | undefined) =>
		v !== undefined && versionsEqual(ecosystem, installed, v);
	if (entry.kind === "question") return same(entry.version);
	if (entry.kind !== "problem") return false;
	return (
		same(entry.reportedVersion) ||
		same(entry.authorObservedVersion) ||
		entry.rows.some((row) => row.confirmNonBurst !== 0 && same(row.version))
	);
}

/** 12.4: exactly one mark, the first whose condition holds. */
export function markEntry(
	ecosystem: Ecosystem,
	entry: Entry,
	installed: string | undefined,
	threshold: number = LIMITS.notReproducedThreshold,
): Mark {
	if (entry.kind === "reply") return "unknown";
	if (isResolvedForYou(ecosystem, entry, installed)) return "resolved";
	if (
		entry.kind === "problem" &&
		isNotReproducedOnNewer(ecosystem, entry, installed, threshold)
	) {
		return "not-reproduced-on-newer";
	}
	if (
		entry.kind === "problem" &&
		isDisputedOnYourVersion(ecosystem, entry, installed)
	) {
		return "disputed-on-your-version";
	}
	if (isSameVersion(ecosystem, entry, installed)) return "same-version";
	return "unknown";
}
