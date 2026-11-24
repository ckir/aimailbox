import type { ProblemEntry } from "./entry.ts";

export const T0 = 1_700_000_000;

export const workedEntry: ProblemEntry = {
	formatVersion: 1,
	noteNumber: 41,
	kind: "problem",
	timeWritten: T0,
	summary: "install fails when the lock file is stale",
	warningTags: [],
	replyCount: 2,
	reportedVersion: "1.2.0",
	confirm: {
		total: 4,
		nonBurstTotal: 4,
		burst: false,
		lastNonBurstTime: T0 + 500,
	},
	doesNotReproduce: {
		total: 3,
		nonBurstTotal: 3,
		burst: false,
		lastNonBurstTime: T0 + 600,
	},
	rows: [
		{
			version: "1.2.0",
			confirmTotal: 2,
			confirmNonBurst: 2,
			doesNotReproduceTotal: 0,
			doesNotReproduceNonBurst: 0,
		},
		{
			version: "1.2.1",
			confirmTotal: 2,
			confirmNonBurst: 2,
			doesNotReproduceTotal: 0,
			doesNotReproduceNonBurst: 0,
		},
		{
			version: "1.3.0",
			confirmTotal: 0,
			confirmNonBurst: 0,
			doesNotReproduceTotal: 3,
			doesNotReproduceNonBurst: 3,
		},
	],
	highestConfirmedVersion: "1.2.1",
};

export function problemEntry(
	overrides: Partial<ProblemEntry> = {},
): ProblemEntry {
	return {
		formatVersion: 1,
		noteNumber: 1,
		kind: "problem",
		timeWritten: T0,
		summary: "placeholder summary",
		warningTags: [],
		replyCount: 0,
		confirm: { total: 0, nonBurstTotal: 0, burst: false },
		doesNotReproduce: { total: 0, nonBurstTotal: 0, burst: false },
		rows: [],
		...overrides,
	};
}
