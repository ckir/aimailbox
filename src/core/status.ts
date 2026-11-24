import type { Ecosystem } from "./ecosystem.ts";
import type { FormCounts, VersionRow } from "./entry.ts";
import { LIMITS } from "./limits.ts";
import { canOrder, compareVersions, rowKey } from "./version.ts";

export type Vote = {
	form: "confirm" | "doesNotReproduce";
	version?: string;
	arrivalTime: number;
	isBurst: boolean;
};
export type StatusCounts = {
	confirm: FormCounts;
	doesNotReproduce: FormCounts;
	rows: VersionRow[];
	highestConfirmedVersion?: string;
};

type Tally = { row: VersionRow; latest: number; ordered: boolean };

function formCounts(votes: readonly Vote[], form: Vote["form"]): FormCounts {
	let total = 0;
	let nonBurstTotal = 0;
	let burst = false;
	let last: number | undefined;
	for (const vote of votes) {
		if (vote.form !== form) continue;
		total++;
		if (vote.isBurst) {
			burst = true;
			continue;
		}
		nonBurstTotal++;
		if (last === undefined || vote.arrivalTime > last) last = vote.arrivalTime;
	}
	const counts: FormCounts = { total, nonBurstTotal, burst };
	if (last !== undefined) counts.lastNonBurstTime = last;
	return counts;
}

function byKey(a: Tally, b: Tally): number {
	return a.row.version < b.row.version
		? -1
		: a.row.version > b.row.version
			? 1
			: 0;
}

// Rows that can be ordered, ascending by version (ties by key); the key is the version of a row.
function byVersion(ecosystem: Ecosystem): (a: Tally, b: Tally) => number {
	return (a, b) =>
		compareVersions(ecosystem, a.row.version, b.row.version) || byKey(a, b);
}

function tallyRows(ecosystem: Ecosystem, votes: readonly Vote[]): Tally[] {
	const tallies = new Map<string, Tally>();
	for (const vote of votes) {
		if (vote.version === undefined) continue;
		const key = rowKey(ecosystem, vote.version);
		let tally = tallies.get(key);
		if (tally === undefined) {
			tally = {
				row: {
					version: key,
					confirmTotal: 0,
					confirmNonBurst: 0,
					doesNotReproduceTotal: 0,
					doesNotReproduceNonBurst: 0,
				},
				latest: vote.arrivalTime,
				ordered: canOrder(ecosystem, vote.version),
			};
			tallies.set(key, tally);
		}
		if (vote.arrivalTime > tally.latest) tally.latest = vote.arrivalTime;
		if (vote.form === "confirm") {
			tally.row.confirmTotal++;
			if (!vote.isBurst) tally.row.confirmNonBurst++;
		} else {
			tally.row.doesNotReproduceTotal++;
			if (!vote.isBurst) tally.row.doesNotReproduceNonBurst++;
		}
	}
	return [...tallies.values()];
}

function highestConfirmed(
	ecosystem: Ecosystem,
	votes: readonly Vote[],
): string | undefined {
	let highest: string | undefined;
	for (const vote of votes) {
		if (vote.form !== "confirm" || vote.isBurst) continue;
		if (vote.version === undefined || !canOrder(ecosystem, vote.version)) {
			continue;
		}
		const key = rowKey(ecosystem, vote.version);
		if (
			highest === undefined ||
			compareVersions(ecosystem, key, highest) === 1
		) {
			highest = key;
		}
	}
	return highest;
}

export function deriveStatus(
	ecosystem: Ecosystem,
	votes: readonly Vote[],
	maxRows: number = LIMITS.versionRows,
): StatusCounts {
	if (!Number.isInteger(maxRows) || maxRows < 1) {
		throw new RangeError("maxRows must be a positive integer");
	}
	const tallies = tallyRows(ecosystem, votes);
	const orderable = tallies.filter((t) => t.ordered).sort(byVersion(ecosystem));
	const unorderable = tallies
		.filter((t) => !t.ordered)
		.sort((a, b) => a.latest - b.latest || byKey(a, b));
	// Unorderable rows go first, least recent first, then orderable rows, oldest version first.
	const drop = Math.max(0, tallies.length - maxRows);
	const dropUnorderable = Math.min(drop, unorderable.length);
	const keptOrderable = orderable.slice(drop - dropUnorderable);
	const keptUnorderable = unorderable.slice(dropUnorderable).sort(byKey);
	const result: StatusCounts = {
		confirm: formCounts(votes, "confirm"),
		doesNotReproduce: formCounts(votes, "doesNotReproduce"),
		rows: [...keptOrderable, ...keptUnorderable].map((t) => t.row),
	};
	const highest = highestConfirmed(ecosystem, votes);
	if (highest !== undefined) result.highestConfirmedVersion = highest;
	return result;
}
