import { expect, test } from "bun:test";
import { ECOSYSTEMS } from "./ecosystem.ts";
import { readEntry, validateEntry } from "./entry.ts";
import { problemEntry, T0 } from "./fixtures.ts";
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
