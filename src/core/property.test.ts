// Seeded, bounded property tests for the pure modules of src/core. Every
// random choice comes from mulberry32 with one fixed seed per describe block
// (no Math.random, no clock), so a failure reproduces exactly. Generators lean
// on boundary values: the limits of limits.ts at -1, 0 and +1, astral code
// points, combining marks, default-ignorable code points, characters that
// NFKC changes, and the version strings that 12.1 and 12.3 single out.
import { describe, expect, test } from "bun:test";
import { ECOSYSTEMS, type Ecosystem } from "./ecosystem.ts";
import {
	type Entry,
	type PageEntry,
	type ReplyEntry,
	readDigestPage,
	readEntry,
	validateEntry,
} from "./entry.ts";
import { problemEntry, T0 } from "./fixtures.ts";
import { countMatches, foldText, queryWords, wordsOf } from "./fold.ts";
import { LIMITS, WARNING_TAGS } from "./limits.ts";
import { listReplies, lookupGroup } from "./lookup.ts";
import { type Mark, markEntry } from "./mark.ts";
import {
	type NoteContent,
	prepareDraft,
	readPublishedNote,
	validateWrite,
} from "./note.ts";
import {
	compareEntries,
	MARK_RANK,
	type OrderKeys,
	orderKeys,
	sortEntries,
} from "./order.ts";
import { deriveStatus, type Vote } from "./status.ts";
import {
	codePointLength,
	cutToBytes,
	cutToCodePoints,
	isConforming,
	stripForbidden,
	utf8Length,
} from "./text.ts";
import {
	canOrder,
	compareVersions,
	isValidVersion,
	rowKey,
	rowVersion,
	versionsEqual,
} from "./version.ts";

// ---------------------------------------------------------------- helpers

type Rng = () => number;

function mulberry32(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** An integer in 0 .. n-1. */
const int = (r: Rng, n: number): number => Math.floor(r() * n);
const chance = (r: Rng, p: number): boolean => r() < p;
const pick = <T>(r: Rng, items: readonly T[]): T =>
	items[int(r, items.length)] as T;

function shuffled<T>(r: Rng, items: readonly T[]): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = int(r, i + 1);
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}

/** `n` random picks from `pool`, `n` in 0 .. max. */
function tokens(r: Rng, pool: readonly string[], max: number): string[] {
	return Array.from({ length: int(r, max + 1) }, () => pick(r, pool));
}

/** A string whose `measure` is exactly `target`: whole tokens, then "a" padding. */
function buildExact(
	r: Rng,
	pool: readonly string[],
	measure: (text: string) => number,
	target: number,
): string {
	let text = "";
	let used = 0;
	for (;;) {
		const next = pick(r, pool);
		const size = measure(next);
		if (used + size > target) break;
		text += next;
		used += size;
	}
	return text + "a".repeat(target - used);
}

// -------------------------------------------------------------- text pools

// Kept by stripForbidden: ASCII, a combining mark alone and after a base,
// astral code points (4 bytes, a surrogate pair), a ligature and other NFKC
// movers, spaces that are not line ends, and the replacement character.
const KEPT = [
	"a",
	"Z",
	"7",
	" ",
	"\n",
	"\t",
	"e",
	"\u0301",
	"\u00e9",
	"e\u0301",
	"\u{1f600}",
	"\u{1f468}",
	"\u{10000}",
	"\u{20000}",
	"\ufb01",
	"\u00a0",
	"\u2003",
	"\u3000",
	"\u4e2d",
	"\u00df",
	"\u0130",
	"\u212b",
	"\u2460",
	"\uff21",
	"\ufffd",
	"-",
	"_",
	"'",
];
// Removed by stripForbidden because of their category: Cc, Cf, Cs, Co, Cn, Zl, Zp.
const FORBIDDEN = [
	"\u0000",
	"\u0007",
	"\u001b",
	"\u007f",
	"\u0085",
	"\u009f",
	"\u00ad",
	"\u200b",
	"\u200d",
	"\u200e",
	"\u202e",
	"\u2060",
	"\u2066",
	"\ufeff",
	"\ufff9",
	"\ud800",
	"\ue000",
	"\u{f0000}",
	"\u0378",
	"\ufffe",
	"\u{10ffff}",
	"\u2028",
	"\u2029",
	"\u{e0001}",
];
// Default_Ignorable_Code_Point that none of those categories contains.
const DEFAULT_IGNORABLE = [
	"\u034f",
	"\u115f",
	"\u1160",
	"\u17b4",
	"\u180b",
	"\u3164",
	"\ufe00",
	"\ufe0e",
	"\ufe0f",
	"\uffa0",
	"\u{e0100}",
	"\u{e01ef}",
];
const UNITS = [
	...KEPT.map((s) => ({ s, forbidden: false })),
	...FORBIDDEN.map((s) => ({ s, forbidden: true })),
	...DEFAULT_IGNORABLE.map((s) => ({ s, forbidden: true })),
];
// Well-formed strings only: no lone surrogate.
const WELL_FORMED = [...KEPT, ...FORBIDDEN.filter((s) => s !== "\ud800")];
const SINGLE_LINE = KEPT.filter((s) => s !== "\n");

// ------------------------------------------------------------------- text

describe("text", () => {
	const SEED = 0x7e570001;

	test("stripForbidden removes exactly the forbidden units, keeps the rest, and is idempotent", () => {
		const r = mulberry32(SEED);
		for (let i = 0; i < 105; i++) {
			const parts = Array.from({ length: int(r, 26) }, () => pick(r, UNITS));
			const input = parts.map((p) => p.s).join("");
			const want = parts
				.filter((p) => !p.forbidden)
				.map((p) => p.s)
				.join("");
			const got = stripForbidden(input);
			expect(got).toBe(want);
			expect(stripForbidden(got)).toBe(got);
			expect(isConforming(got)).toBe(true);
			// Nothing from the forbidden categories is left but line feed and tab.
			expect(got.replace(/[\n\t]/g, "")).not.toMatch(
				/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u,
			);
		}
	});

	test("stripForbidden turns every CR LF and every lone CR into one line feed first", () => {
		const r = mulberry32(SEED + 1);
		const pool = ["\r", "\r\n", "\n", "a", "\u200b", "\u2028", "\t"];
		for (let i = 0; i < 78; i++) {
			const input = tokens(r, pool, 14).join("");
			const got = stripForbidden(input);
			expect(got).not.toContain("\r");
			const want = input
				.replaceAll("\r\n", "\n")
				.replaceAll("\r", "\n")
				.replace(/[\u200b\u2028]/g, "");
			expect(got).toBe(want);
			expect(stripForbidden(got)).toBe(got);
		}
	});

	test("stripForbidden removes every Default_Ignorable_Code_Point (7.1 revision 8, built in plan 2)", () => {
		for (const unit of DEFAULT_IGNORABLE) {
			expect(stripForbidden(`a${unit}b`)).toBe("ab");
		}
		const ranges: [number, number][] = [
			[0, 0xd7ff],
			[0xe000, 0xffff],
			[0x1bca0, 0x1bcaf],
			[0x1d170, 0x1d17f],
			[0xe0000, 0xe0fff],
		];
		let missed = 0;
		for (const [from, to] of ranges) {
			for (let cp = from; cp <= to; cp++) {
				const ch = String.fromCodePoint(cp);
				if (/\p{Default_Ignorable_Code_Point}/u.test(ch)) {
					if (stripForbidden(ch) !== "") missed++;
				}
			}
		}
		expect(missed).toBe(0);
	});

	test("cutToBytes never splits a code point and returns the longest prefix that fits", () => {
		const r = mulberry32(SEED + 2);
		const limits = [
			0,
			1,
			2,
			3,
			4,
			5,
			LIMITS.failureSignatureBytes,
			LIMITS.whatWasExpectedBytes,
			LIMITS.whatWasDoneBytes,
			LIMITS.freeTextBytes,
			LIMITS.noteTextBytes,
		];
		for (const limit of limits) {
			for (const delta of [-1, 0, 1, 3]) {
				const text = buildExact(
					r,
					WELL_FORMED,
					utf8Length,
					Math.max(0, limit + delta),
				);
				const cut = cutToBytes(text, limit);
				expect(text.startsWith(cut)).toBe(true);
				expect(cut.isWellFormed()).toBe(true);
				expect(utf8Length(cut)).toBeLessThanOrEqual(limit);
				expect(cutToBytes(cut, limit)).toBe(cut);
				if (utf8Length(text) <= limit) {
					expect(cut).toBe(text);
				} else {
					const next = String.fromCodePoint(
						text.codePointAt(cut.length) as number,
					);
					expect(utf8Length(cut + next)).toBeGreaterThan(limit);
				}
			}
		}
		for (let i = 0; i < 78; i++) {
			const text = tokens(r, WELL_FORMED, 14).join("");
			const limit = int(r, 24);
			const cut = cutToBytes(text, limit);
			expect(text.startsWith(cut)).toBe(true);
			expect(cut.isWellFormed()).toBe(true);
			expect(utf8Length(cut)).toBeLessThanOrEqual(limit);
			expect(cutToBytes(cut, limit)).toBe(cut);
			if (cut !== text) {
				const next = String.fromCodePoint(
					text.codePointAt(cut.length) as number,
				);
				expect(utf8Length(cut + next)).toBeGreaterThan(limit);
			}
		}
	});

	test("cutToCodePoints never splits a code point and keeps exactly the limit", () => {
		const r = mulberry32(SEED + 3);
		const limits = [0, 1, 2, 3, LIMITS.summaryCodePoints];
		for (const limit of limits) {
			for (const delta of [-1, 0, 1, 3]) {
				const text = buildExact(
					r,
					WELL_FORMED,
					codePointLength,
					Math.max(0, limit + delta),
				);
				const cut = cutToCodePoints(text, limit);
				expect(text.startsWith(cut)).toBe(true);
				expect(cut.isWellFormed()).toBe(true);
				expect(codePointLength(cut)).toBe(
					Math.min(limit, codePointLength(text)),
				);
				expect(cutToCodePoints(cut, limit)).toBe(cut);
			}
		}
		for (let i = 0; i < 78; i++) {
			const text = tokens(r, WELL_FORMED, 14).join("");
			const limit = int(r, 20);
			const cut = cutToCodePoints(text, limit);
			expect(text.startsWith(cut)).toBe(true);
			expect(cut.isWellFormed()).toBe(true);
			expect(codePointLength(cut)).toBe(Math.min(limit, codePointLength(text)));
			expect(cutToCodePoints(cut, limit)).toBe(cut);
		}
	});

	test("both cuts fail closed on a limit that is NaN or below 1 and round a fraction down", () => {
		const r = mulberry32(SEED + 4);
		for (let i = 0; i < 42; i++) {
			const text = tokens(r, WELL_FORMED, 8).join("");
			for (const bad of [Number.NaN, -1, -0.5, 0, 0.9, -Infinity]) {
				expect(cutToBytes(text, bad)).toBe("");
				expect(cutToCodePoints(text, bad)).toBe("");
			}
			const n = 1 + int(r, 10);
			expect(cutToBytes(text, n + 0.9)).toBe(cutToBytes(text, n));
			expect(cutToCodePoints(text, n + 0.9)).toBe(cutToCodePoints(text, n));
		}
	});
});

// ------------------------------------------------------------------- fold

// Pieces chosen so NFKC and case folding both have work to do: sharp s,
// capital sharp s, dotted capital I, dotless i, ligatures, a title-case
// digraph, the angstrom and ohm signs (singletons that NFKC maps to letters),
// circled and vulgar fractions, full-width and half-width forms, Arabic-Indic
// digits, an Arabic ligature and a unit sign that expand, combining marks and
// default-ignorable code points that sit inside or between words.
const FOLD_PIECES = [
	"a",
	"B",
	"z",
	"Z",
	"0",
	"9",
	"\u0663",
	"\u00df",
	"\u1e9e",
	"\u0130",
	"\u0131",
	"\u01c5",
	"\ufb01",
	"\ufb03",
	"\u0149",
	"\u0390",
	"\u1fbc",
	"\u00c5",
	"\u212b",
	"\u2126",
	"\u2460",
	"\u00bd",
	"\uff21",
	"\uff71",
	"\ufdfa",
	"\u338f",
	"\u0301",
	"\u034f",
	"\ufe0f",
	"\u3164",
	"\u200d",
	"\u00ad",
	"\u{1f600}",
	"\u4e2d",
	"\ud55c",
	"-",
	"_",
	" ",
	"'",
	"\n",
	".",
	"lock",
	"File",
	"STRASSE",
];

describe("fold", () => {
	const SEED = 0xf01d0002;
	const sample = (r: Rng, max: number) => tokens(r, FOLD_PIECES, max).join("");

	test("foldText is idempotent", () => {
		const r = mulberry32(SEED);
		for (let i = 0; i < 131; i++) {
			const text = sample(r, 12);
			const once = foldText(text);
			expect(foldText(once)).toBe(once);
			// The result is itself in NFKC, and the input's normal form is moot.
			expect(once.normalize("NFKC")).toBe(once);
			expect(foldText(text.normalize("NFD"))).toBe(once);
			expect(foldText(text.normalize("NFC"))).toBe(once);
		}
		expect(foldText("")).toBe("");
	});

	test("every word of wordsOf is non-empty, only letters and digits, and a fixed point of foldText", () => {
		const r = mulberry32(SEED + 1);
		for (let i = 0; i < 131; i++) {
			for (const word of wordsOf(sample(r, 14))) {
				expect(word).not.toBe("");
				expect(word).toMatch(/^[\p{L}\p{Nd}]+$/u);
				expect(foldText(word)).toBe(word);
			}
		}
	});

	test("queryWords are distinct, folded, in first-appearance order and cut at the word limit", () => {
		const r = mulberry32(SEED + 2);
		for (let i = 0; i < 105; i++) {
			// Many short words so the count reaches and passes queryWords.
			const parts = Array.from({ length: int(r, 20) }, () =>
				chance(r, 0.5) ? `w${int(r, 12)}` : sample(r, 3),
			);
			const query = parts.join(" ");
			const words = queryWords(query);
			const all = wordsOf(query);
			const distinct = [...new Set(all)];
			expect(words.length).toBe(Math.min(distinct.length, LIMITS.queryWords));
			expect(new Set(words).size).toBe(words.length);
			expect(words).toEqual(distinct.slice(0, words.length));
			for (const word of words) expect(foldText(word)).toBe(word);
		}
		// Exactly at the limit and one past it.
		const eight = Array.from({ length: LIMITS.queryWords }, (_, k) => `w${k}`);
		expect(queryWords(eight.join(" "))).toEqual(eight);
		expect(queryWords([...eight, "extra"].join(" "))).toEqual(eight);
	});

	test("countMatches is between 0 and the number of distinct words and ignores order, repeats and case", () => {
		const r = mulberry32(SEED + 3);
		for (let i = 0; i < 131; i++) {
			const words = tokens(r, FOLD_PIECES, 8);
			const text = sample(r, 14);
			const count = countMatches(words, text);
			const distinct = new Set(words.map(foldText)).size;
			expect(count).toBeGreaterThanOrEqual(0);
			expect(count).toBeLessThanOrEqual(distinct);
			expect(Number.isInteger(count)).toBe(true);
			expect(countMatches(shuffled(r, words), text)).toBe(count);
			expect(countMatches([...words, ...words], text)).toBe(count);
			expect(countMatches(words, "")).toBe(0);
			expect(countMatches([], text)).toBe(0);
			// A longer text never matches fewer words.
			expect(
				countMatches(words, `${text}\n${sample(r, 6)}`),
			).toBeGreaterThanOrEqual(count);
			// A text matches every word of its own query.
			const own = queryWords(text);
			expect(countMatches(own, text)).toBe(own.length);
		}
	});
});

// ---------------------------------------------------------------- version

const LONG_PRE = `1.0.0-${"a".repeat(58)}`; // 64 characters, orderable
const FIXED_VERSIONS = [
	// valid under 12.1
	"1.0.0",
	"v1.0.0",
	"1.0.0+b",
	"v1.0.0+c",
	"1.0.0+b.1-x",
	"1.0.0-rc.1",
	"1.0.0-rc.1+b",
	"1.0.0-rc.2",
	"1.0.0-rc.10",
	"1.0.0-alpha",
	"1.0.0-alpha.1",
	"1.0.0-alpha.beta",
	"1.0.0-beta",
	"1.0.0-beta.2",
	"1.0.0-beta.11",
	"1.0.0-0",
	"1.0.0-1",
	"1.0.0-10",
	"1.0.0-a-b",
	"0.0.0",
	"0.9.9",
	"1.0.1",
	"1.1.0",
	"1.2.0",
	"1.10.0",
	"2.0.0",
	"2.0.0-rc.1",
	"10.0.0",
	"99999999999999999999.0.0",
	"100000000000000000000.0.0",
	// valid but not strict SemVer, so they cannot be ordered
	"v",
	"vv1.0.0",
	"vv",
	"01.0",
	"1.0",
	"1.0.0.0",
	"01.0.0",
	"1.0.0-01",
	"1.0.0-",
	"1.0.0+",
	"1.0.0-rc..1",
	"latest",
	"x_y~z:1!",
	// boundary lengths
	LONG_PRE,
	`v${"1".repeat(63)}`,
	"a".repeat(64),
	`v${LONG_PRE.slice(0, 63)}`,
];
const INVALID_VERSIONS = [
	"",
	" ",
	"1.0.0 ",
	"1.0.0\n",
	"\u00e9",
	"1.0/0",
	"a".repeat(65),
	`${LONG_PRE}a`,
	`v${LONG_PRE}`,
	`v${"1".repeat(64)}`,
];
const NUMS = ["0", "1", "2", "9", "10", "01", "007", "99999999999999999999"];
const IDS = ["0", "1", "01", "10", "alpha", "rc", "a-b", "-", "1a", "x.y"];

function genVersion(r: Rng): string {
	if (chance(r, 0.4)) return pick(r, FIXED_VERSIONS);
	const lead = chance(r, 0.4) ? "v".repeat(1 + int(r, 2)) : "";
	const core = [pick(r, NUMS), pick(r, NUMS), pick(r, NUMS)].join(".");
	const pre = chance(r, 0.4) ? `-${tokens(r, IDS, 3).join(".") || "rc"}` : "";
	const build = chance(r, 0.3) ? `+${pick(r, ["b", "1", "b.2", "-"])}` : "";
	return `${lead}${core}${pre}${build}`;
}

const validVersion = (r: Rng): string => {
	for (;;) {
		const v = genVersion(r);
		if (isValidVersion(v)) return v;
	}
};

describe("version", () => {
	const SEED = 0x7e550003;
	const ORDERED: Ecosystem[] = ["npm", "cargo", "go"];

	test("the fixed pool covers both valid and invalid versions (not vacuous)", () => {
		expect(FIXED_VERSIONS.every(isValidVersion)).toBe(true);
		expect(INVALID_VERSIONS.every((v) => !isValidVersion(v))).toBe(true);
		expect(
			FIXED_VERSIONS.filter((v) => canOrder("npm", v)).length,
		).toBeGreaterThan(20);
		expect(
			FIXED_VERSIONS.filter((v) => !canOrder("npm", v)).length,
		).toBeGreaterThan(10);
	});

	test("compareVersions is reflexive, antisymmetric and defined exactly when both sides can be ordered", () => {
		const r = mulberry32(SEED);
		const pool = [
			...FIXED_VERSIONS,
			...INVALID_VERSIONS,
			...Array.from({ length: 8 }, () => genVersion(r)),
		];
		const bad: string[] = [];
		for (const eco of ["npm", "pypi", "tool"] as const) {
			for (const a of pool) {
				if (canOrder(eco, a) && compareVersions(eco, a, a) !== 0) {
					bad.push(`${eco} ${a} is not equal to itself`);
				}
				for (const b of pool) {
					const ab = compareVersions(eco, a, b);
					const ba = compareVersions(eco, b, a);
					const both = canOrder(eco, a) && canOrder(eco, b);
					if ((ab === undefined) !== !both || (ba === undefined) !== !both) {
						bad.push(`${eco} ${a} ${b} defined: ${ab} ${ba}`);
					} else if (ab !== undefined && ba !== undefined && ab + ba !== 0) {
						bad.push(`${eco} ${a} ${b} not antisymmetric: ${ab} ${ba}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
	});

	test("compareVersions is transitive on every triple of a sampled set", () => {
		const r = mulberry32(SEED + 1);
		const pool = [
			...shuffled(
				r,
				FIXED_VERSIONS.filter((v) => canOrder("npm", v)),
			).slice(0, 20),
		];
		while (pool.length < 16) {
			const v = genVersion(r);
			if (canOrder("npm", v)) pool.push(v);
		}
		const bad: string[] = [];
		for (const a of pool) {
			for (const b of pool) {
				const ab = compareVersions("npm", a, b) as number;
				for (const c of pool) {
					const bc = compareVersions("npm", b, c) as number;
					const ac = compareVersions("npm", a, c) as number;
					const wrong =
						(ab <= 0 && bc <= 0 && ac > 0) ||
						((ab < 0 || bc < 0) && ab <= 0 && bc <= 0 && ac >= 0) ||
						(ab === 0 && bc === 0 && ac !== 0);
					if (wrong) bad.push(`${a} ${b} ${c}: ${ab} ${bc} ${ac}`);
				}
			}
		}
		expect(bad).toEqual([]);
	});

	test("semver.org precedence: the published chain is strictly increasing, with or without a leading v or build", () => {
		const chain = [
			"1.0.0-alpha",
			"1.0.0-alpha.1",
			"1.0.0-alpha.beta",
			"1.0.0-beta",
			"1.0.0-beta.2",
			"1.0.0-beta.11",
			"1.0.0-rc.1",
			"1.0.0",
			"2.0.0",
			"2.1.0",
			"2.1.1",
		];
		for (const eco of ORDERED) {
			for (const decorate of [
				(v: string) => v,
				(v: string) => `v${v}`,
				(v: string) => `${v}+build.5`,
			]) {
				for (let i = 0; i < chain.length; i++) {
					for (let j = 0; j < chain.length; j++) {
						const want = i < j ? -1 : i > j ? 1 : 0;
						expect(
							compareVersions(
								eco,
								decorate(chain[i] as string),
								decorate(chain[j] as string),
							),
						).toBe(want);
					}
				}
			}
		}
	});

	test("versionsEqual is symmetric, reflexive on valid versions, and agrees with compareVersions", () => {
		const r = mulberry32(SEED + 2);
		const pool = [
			...FIXED_VERSIONS,
			...INVALID_VERSIONS,
			...Array.from({ length: 8 }, () => genVersion(r)),
		];
		const bad: string[] = [];
		for (const eco of ["npm", "pypi", "tool"] as const) {
			for (const a of pool) {
				if (versionsEqual(eco, a, a) !== isValidVersion(a)) {
					bad.push(`${eco} ${a} reflexive`);
				}
				for (const b of pool) {
					const ab = versionsEqual(eco, a, b);
					if (ab !== versionsEqual(eco, b, a)) bad.push(`${eco} ${a} ${b} sym`);
					if (compareVersions(eco, a, b) === 0 && !ab) {
						bad.push(`${eco} ${a} ${b} compare 0 but not equal`);
					}
					if ((!isValidVersion(a) || !isValidVersion(b)) && ab) {
						bad.push(`${eco} ${a} ${b} invalid but equal`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
	});

	test("rowVersion of a valid version is valid, is the key or the version as written, and is stable", () => {
		const r = mulberry32(SEED + 3);
		const pool = [
			...FIXED_VERSIONS,
			...Array.from({ length: 300 }, () => genVersion(r)).filter(
				isValidVersion,
			),
		];
		for (const eco of ECOSYSTEMS) {
			for (const v of pool) {
				const row = rowVersion(eco, v);
				expect(isValidVersion(row)).toBe(true);
				expect(row === v || row === rowKey(eco, v)).toBe(true);
				expect(rowKey(eco, row) === row || row === v).toBe(true);
				expect(rowVersion(eco, row)).toBe(row);
				// The row keeps the version it stands for.
				expect(versionsEqual(eco, v, row)).toBe(true);
			}
		}
	});

	test("rowVersion returns an invalid version unchanged", () => {
		const r = mulberry32(SEED + 4);
		const pool = [
			...INVALID_VERSIONS,
			...Array.from({ length: 100 }, () => genVersion(r)).filter(
				(v) => !isValidVersion(v),
			),
			...Array.from({ length: 40 }, () => `v${"x".repeat(64 - int(r, 3))}`),
		];
		for (const eco of ECOSYSTEMS) {
			for (const v of pool) {
				if (!isValidVersion(v)) expect(rowVersion(eco, v)).toBe(v);
			}
		}
	});

	test("versions that compare equal share one row key and one row version", () => {
		const r = mulberry32(SEED + 5);
		const pool = [
			...FIXED_VERSIONS,
			...Array.from({ length: 80 }, () => genVersion(r)).filter(isValidVersion),
		].filter((v) => canOrder("npm", v));
		for (const a of pool) {
			for (const b of pool) {
				if (compareVersions("npm", a, b) !== 0) continue;
				expect(rowKey("npm", a)).toBe(rowKey("npm", b));
				expect(rowVersion("npm", a)).toBe(rowVersion("npm", b));
			}
		}
	});
});

// ----------------------------------------------------------------- status

const VOTE_VERSIONS = [
	"1.0.0",
	"v1.0.0",
	"1.0.0+b",
	"v1.0.0+c",
	"1.1.0",
	"v1.1.0",
	"2.0.0-rc.1",
	"2.0.0",
	"1.0",
	"vv1.0.0",
	"v",
	"latest",
	LONG_PRE,
	`v${"1".repeat(63)}`,
];

function genVotes(r: Rng, many: boolean): Vote[] {
	const n = int(r, many ? 46 : 16);
	return Array.from({ length: n }, () => {
		const v = chance(r, 0.15)
			? undefined
			: many
				? chance(r, 0.7)
					? `1.${int(r, 30)}.0`
					: `tool-${int(r, 30)}`
				: pick(r, VOTE_VERSIONS);
		const vote: Vote = {
			form: chance(r, 0.5) ? "confirm" : "doesNotReproduce",
			arrivalTime: T0 + int(r, 6),
			isBurst: chance(r, 0.3),
		};
		if (v !== undefined) vote.version = v;
		return vote;
	});
}

describe("status", () => {
	const SEED = 0x57a70004;
	const MAX_ROWS = [1, 2, 3, 16, 1000];

	test("the status data does not depend on the order of the votes", () => {
		const r = mulberry32(SEED);
		for (let i = 0; i < 70; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const votes = genVotes(r, chance(r, 0.4));
			const maxRows = pick(r, MAX_ROWS);
			const want = deriveStatus(eco, votes, maxRows);
			expect(deriveStatus(eco, shuffled(r, votes), maxRows)).toStrictEqual(
				want,
			);
			expect(deriveStatus(eco, [...votes].reverse(), maxRows)).toStrictEqual(
				want,
			);
		}
	});

	test("the form counts are exact and the row totals equal the sums over the votes", () => {
		const r = mulberry32(SEED + 1);
		for (let i = 0; i < 70; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const votes = genVotes(r, chance(r, 0.4));
			const s = deriveStatus(eco, votes, 1000);
			for (const form of ["confirm", "doesNotReproduce"] as const) {
				const mine = votes.filter((v) => v.form === form);
				const fresh = mine.filter((v) => !v.isBurst);
				const counts = s[form];
				expect(counts.total).toBe(mine.length);
				expect(counts.nonBurstTotal).toBe(fresh.length);
				expect(counts.burst).toBe(mine.some((v) => v.isBurst));
				if (fresh.length === 0) {
					expect("lastNonBurstTime" in counts).toBe(false);
				} else {
					expect(counts.lastNonBurstTime).toBe(
						Math.max(...fresh.map((v) => v.arrivalTime)),
					);
				}
			}
			const versioned = votes.filter((v) => v.version !== undefined);
			const sum = (read: (row: (typeof s.rows)[number]) => number) =>
				s.rows.reduce((total, row) => total + read(row), 0);
			const count = (form: Vote["form"], fresh: boolean) =>
				versioned.filter((v) => v.form === form && (!fresh || !v.isBurst))
					.length;
			expect(sum((row) => row.confirmTotal)).toBe(count("confirm", false));
			expect(sum((row) => row.confirmNonBurst)).toBe(count("confirm", true));
			expect(sum((row) => row.doesNotReproduceTotal)).toBe(
				count("doesNotReproduce", false),
			);
			expect(sum((row) => row.doesNotReproduceNonBurst)).toBe(
				count("doesNotReproduce", true),
			);
			expect(new Set(s.rows.map((row) => rowKey(eco, row.version))).size).toBe(
				s.rows.length,
			);
		}
	});

	test("a smaller row limit keeps unchanged rows, and kept plus dropped rows add up to the full table", () => {
		const r = mulberry32(SEED + 2);
		for (let i = 0; i < 70; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const votes = genVotes(r, chance(r, 0.6));
			const maxRows = pick(r, [1, 2, 3, 5, 16]);
			const full = deriveStatus(eco, votes, 1000);
			const cut = deriveStatus(eco, votes, maxRows);
			expect(cut.confirm).toStrictEqual(full.confirm);
			expect(cut.doesNotReproduce).toStrictEqual(full.doesNotReproduce);
			expect(cut.highestConfirmedVersion).toBe(full.highestConfirmedVersion);
			expect(cut.rows.length).toBe(Math.min(maxRows, full.rows.length));
			const byVersion = new Map(full.rows.map((row) => [row.version, row]));
			for (const row of cut.rows)
				expect(byVersion.get(row.version)).toEqual(row);
			const kept = new Set(cut.rows.map((row) => row.version));
			expect(kept.size).toBe(cut.rows.length);
			const dropped = full.rows.filter((row) => !kept.has(row.version));
			const total = (rows: typeof full.rows) =>
				rows.reduce(
					(n, row) => n + row.confirmTotal + row.doesNotReproduceTotal,
					0,
				);
			expect(total(cut.rows) + total(dropped)).toBe(total(full.rows));
			// Unorderable rows go first, then the oldest orderable versions.
			const droppedOrderable = dropped.filter((row) =>
				canOrder(eco, row.version),
			);
			const keptUnorderable = cut.rows.filter(
				(row) => !canOrder(eco, row.version),
			);
			const keptOrderable = cut.rows.filter((row) =>
				canOrder(eco, row.version),
			);
			if (droppedOrderable.length > 0) expect(keptUnorderable).toEqual([]);
			for (const lost of droppedOrderable) {
				for (const won of keptOrderable) {
					expect(compareVersions(eco, lost.version, won.version)).toBe(-1);
				}
			}
		}
	});

	test("rows list orderable versions oldest first, then the others by text, and the highest confirmed version is the highest non-burst one", () => {
		const r = mulberry32(SEED + 3);
		for (let i = 0; i < 70; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const votes = genVotes(r, chance(r, 0.3));
			const s = deriveStatus(eco, votes, 1000);
			const orderable = s.rows.filter((row) => canOrder(eco, row.version));
			const rest = s.rows.filter((row) => !canOrder(eco, row.version));
			expect(s.rows).toEqual([...orderable, ...rest]);
			for (let k = 1; k < orderable.length; k++) {
				expect(
					compareVersions(
						eco,
						(orderable[k - 1] as { version: string }).version,
						(orderable[k] as { version: string }).version,
					),
				).toBe(-1);
			}
			for (let k = 1; k < rest.length; k++) {
				expect(
					(rest[k - 1] as { version: string }).version <
						(rest[k] as { version: string }).version,
				).toBe(true);
			}
			const eligible = votes
				.filter(
					(v) =>
						v.form === "confirm" &&
						!v.isBurst &&
						v.version !== undefined &&
						canOrder(eco, v.version),
				)
				.map((v) => rowKey(eco, v.version as string));
			if (eligible.length === 0) {
				expect("highestConfirmedVersion" in s).toBe(false);
			} else {
				const top = s.highestConfirmedVersion as string;
				expect(eligible).toContain(top);
				for (const key of eligible) {
					expect(compareVersions(eco, key, top) as number).toBeLessThanOrEqual(
						0,
					);
				}
			}
		}
	});

	test("a row limit that is not a positive integer is refused", () => {
		for (const bad of [0, -1, 1.5, Number.NaN, Infinity]) {
			expect(() => deriveStatus("npm", [], bad)).toThrow(RangeError);
		}
		expect(deriveStatus("npm", [], 1)).toEqual({
			confirm: { total: 0, nonBurstTotal: 0, burst: false },
			doesNotReproduce: { total: 0, nonBurstTotal: 0, burst: false },
			rows: [],
		});
	});
});

// ---------------------------------------------------- mark / order / lookup

const MARK_VERSIONS = [
	"1.0.0",
	"v1.0.0",
	"1.0.0+b",
	"1.1.0",
	"1.2.0",
	"2.0.0",
	"1.0.0-rc.1",
	"2.0.0-rc.1",
	"1.0",
	"latest",
	"vv1.0.0",
];
const INSTALLED = [...MARK_VERSIONS, "x", "3.0.0", "0.1.0"];
const SUMMARY_WORDS = [
	"lock",
	"file",
	"stale",
	"install",
	"fails",
	"Stra\u00dfe",
	"STRASSE",
	"\uff21bc",
	"\ufb01x",
	"e\u0301cole",
	"x\u3164y",
];
const ORDERING: Ecosystem[] = ["npm", "cargo", "go"];
const ALL_MARKS: Mark[] = [
	"resolved",
	"not-reproduced-on-newer",
	"disputed-on-your-version",
	"same-version",
	"unknown",
];

function genEntry(r: Rng, noteNumber: number): Entry {
	const summary = tokens(r, SUMMARY_WORDS, 4).join(" ") || "lock";
	const timeWritten = T0 + int(r, 4);
	const resolved = chance(r, 0.3)
		? {
				time: T0 + int(r, 10),
				...(chance(r, 0.6) ? { version: pick(r, MARK_VERSIONS) } : {}),
			}
		: undefined;
	const roll = int(r, 10);
	if (roll === 0) {
		return {
			formatVersion: 1,
			noteNumber,
			kind: "reply",
			timeWritten,
			summary,
			warningTags: [],
			parentNoteNumber: 1 + int(r, 3),
			parentGone: chance(r, 0.5),
		};
	}
	if (roll <= 2) {
		return {
			formatVersion: 1,
			noteNumber,
			kind: "question",
			timeWritten,
			summary,
			warningTags: [],
			replyCount: 0,
			...(resolved ? { resolved } : {}),
			...(chance(r, 0.6) ? { version: pick(r, MARK_VERSIONS) } : {}),
		};
	}
	const form = () => {
		const fresh = int(r, 5);
		const burst = int(r, 2);
		return {
			total: fresh + burst,
			nonBurstTotal: fresh,
			burst: burst > 0,
			...(fresh > 0 ? { lastNonBurstTime: T0 + int(r, 10) } : {}),
		};
	};
	const rows = [
		...new Set(Array.from({ length: int(r, 5) }, () => pick(r, MARK_VERSIONS))),
	].map((version) => {
		const confirmTotal = int(r, 6);
		const doesNotReproduceTotal = int(r, 6);
		return {
			version,
			confirmTotal,
			confirmNonBurst: int(r, confirmTotal + 1),
			doesNotReproduceTotal,
			doesNotReproduceNonBurst: int(r, doesNotReproduceTotal + 1),
		};
	});
	return problemEntry({
		noteNumber,
		timeWritten,
		summary,
		confirm: form(),
		doesNotReproduce: form(),
		rows,
		...(resolved ? { resolved } : {}),
		...(chance(r, 0.5) ? { reportedVersion: pick(r, MARK_VERSIONS) } : {}),
		...(chance(r, 0.3)
			? { authorObservedVersion: pick(r, MARK_VERSIONS) }
			: {}),
		...(chance(r, 0.3)
			? { highestConfirmedVersion: pick(r, MARK_VERSIONS) }
			: {}),
		...(chance(r, 0.4) ? { failureSignature: "stale lock" } : {}),
	});
}

const genEntries = (r: Rng, n: number): Entry[] =>
	Array.from({ length: n }, (_, i) => genEntry(r, i + 1));

const okPage = (entry: Entry): PageEntry => ({
	status: "ok",
	value: entry,
	cleaned: false,
});

describe("mark", () => {
	const SEED = 0x3a4b0005;

	test("a mark is always one of the five and a reply never has one", () => {
		const r = mulberry32(SEED);
		const seen = new Set<Mark>();
		for (let i = 0; i < 157; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const entry = genEntry(r, 1);
			const installed = chance(r, 0.15) ? undefined : pick(r, INSTALLED);
			const mark = markEntry(eco, entry, installed);
			expect(ALL_MARKS).toContain(mark);
			seen.add(mark);
			if (entry.kind === "reply") expect(mark).toBe("unknown");
			if (mark === "resolved") {
				expect(
					entry.kind === "reply" ? undefined : entry.resolved,
				).toBeDefined();
			}
			if (installed === undefined) {
				expect(["resolved", "unknown"]).toContain(mark);
			}
			expect(markEntry(eco, entry, installed)).toBe(mark);
		}
		// The generators reach every mark, so the checks above are not vacuous.
		expect([...seen].sort()).toEqual([...ALL_MARKS].sort());
	});

	test("a mark that is not resolved or not-reproduced is disputed or same-version exactly when 12.4 says", () => {
		const r = mulberry32(SEED + 4);
		const seen = new Set<Mark>();
		for (let i = 0; i < 187; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const entry = genEntry(r, 1);
			const installed = pick(r, INSTALLED);
			const mark = markEntry(eco, entry, installed);
			if (mark === "resolved" || mark === "not-reproduced-on-newer") continue;
			const same = (v: string | undefined) =>
				v !== undefined && versionsEqual(eco, installed, v);
			let confirm = 0;
			let doesNotReproduce = 0;
			let mentioned = false;
			if (entry.kind === "problem") {
				for (const row of entry.rows) {
					if (!same(row.version)) continue;
					confirm += row.confirmNonBurst;
					doesNotReproduce += row.doesNotReproduceNonBurst;
				}
				mentioned =
					same(entry.reportedVersion) ||
					same(entry.authorObservedVersion) ||
					confirm > 0;
			} else if (entry.kind === "question") {
				mentioned = same(entry.version);
			}
			const want: Mark =
				entry.kind === "problem" && doesNotReproduce > confirm
					? "disputed-on-your-version"
					: mentioned
						? "same-version"
						: "unknown";
			expect(mark).toBe(want);
			seen.add(mark);
		}
		expect([...seen].sort()).toEqual([
			"disputed-on-your-version",
			"same-version",
			"unknown",
		]);
	});

	test("the mark does not depend on the order of the rows", () => {
		const r = mulberry32(SEED + 1);
		for (let i = 0; i < 131; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const entry = genEntry(r, 1);
			const installed = chance(r, 0.15) ? undefined : pick(r, INSTALLED);
			if (entry.kind !== "problem") continue;
			const twin = { ...entry, rows: shuffled(r, entry.rows) };
			expect(markEntry(eco, twin, installed)).toBe(
				markEntry(eco, entry, installed),
			);
		}
	});

	test("not-reproduced-on-newer holds exactly when the rows up to the installed version reach the threshold, and then at every lower one", () => {
		const r = mulberry32(SEED + 2);
		const ladder = ["1.1.0", "1.2.0", "2.0.0", "3.0.0"];
		let hits = 0;
		for (let i = 0; i < 150; i++) {
			const eco = pick(r, ORDERING);
			// An older report, and newer rows that did not reproduce it.
			const counts = [int(r, 5), int(r, 5), int(r, 5)];
			const entry = problemEntry({
				reportedVersion: "1.0.0",
				rows: counts.map((count, k) => ({
					version: ladder[k] as string,
					confirmTotal: 0,
					confirmNonBurst: 0,
					doesNotReproduceTotal: 4,
					doesNotReproduceNonBurst: count,
				})),
			});
			const installed = pick(r, [...ladder, "x"]);
			const threshold = 1 + int(r, 6);
			const reach = counts
				.filter((_, k) => k <= ladder.indexOf(installed))
				.reduce((sum, count) => sum + count, 0);
			const want = installed !== "x" && reach >= threshold;
			expect(
				markEntry(eco, entry, installed, threshold) ===
					"not-reproduced-on-newer",
			).toBe(want);
			if (!want) continue;
			hits++;
			for (let lower = 1; lower <= threshold; lower++) {
				expect(markEntry(eco, entry, installed, lower)).toBe(
					"not-reproduced-on-newer",
				);
			}
			// No row can reach a threshold of a thousand.
			expect(markEntry(eco, entry, installed, 1000)).not.toBe(
				"not-reproduced-on-newer",
			);
		}
		expect(hits).toBeGreaterThan(30);
	});

	test("a leading v on an installed version that can be ordered does not change the mark", () => {
		const r = mulberry32(SEED + 3);
		let compared = 0;
		for (let i = 0; i < 157; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const entry = genEntry(r, 1);
			const installed = pick(
				r,
				MARK_VERSIONS.filter((v) => !v.startsWith("v")),
			);
			if (!canOrder(eco, installed)) continue;
			compared++;
			expect(markEntry(eco, entry, `v${installed}`)).toBe(
				markEntry(eco, entry, installed),
			);
		}
		expect(compared).toBeGreaterThan(50);
	});
});

describe("order", () => {
	const SEED = 0x0de40006;

	// 12.5: more words, lower mark rank, higher balance, later time, higher number.
	const reference = (a: OrderKeys, b: OrderKeys): number =>
		[
			b.words - a.words,
			a.markRank - b.markRank,
			b.balance - a.balance,
			b.time - a.time,
			b.noteNumber - a.noteNumber,
		].find((difference) => difference !== 0) ?? 0;

	const genKeys = (r: Rng): OrderKeys => ({
		words: int(r, 3),
		markRank: int(r, 3),
		balance: int(r, 3) - 1,
		time: T0 + int(r, 3),
		noteNumber: 1 + int(r, 3),
	});

	test("compareEntries is the lexicographic order of 12.5, antisymmetric and transitive", () => {
		const r = mulberry32(SEED);
		const keys = Array.from({ length: 30 }, () => genKeys(r));
		for (const a of keys) {
			expect(compareEntries(a, a)).toBe(0);
			for (const b of keys) {
				expect(Math.sign(compareEntries(a, b))).toBe(
					Math.sign(reference(a, b)),
				);
				expect(
					Math.sign(compareEntries(a, b)) + Math.sign(compareEntries(b, a)),
				).toBe(0);
				for (const c of keys) {
					if (compareEntries(a, b) <= 0 && compareEntries(b, c) <= 0) {
						expect(compareEntries(a, c)).toBeLessThanOrEqual(0);
					}
				}
			}
		}
	});

	test("the mark ranks follow 12.5: same version, unknown, disputed, not reproduced on newer, resolved", () => {
		const ranks = [
			"same-version",
			"unknown",
			"disputed-on-your-version",
			"not-reproduced-on-newer",
			"resolved",
		].map((mark) => MARK_RANK[mark as Mark]);
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
		expect(new Set(ranks).size).toBe(ALL_MARKS.length);
	});

	test("orderKeys reads the keys off the entry", () => {
		const r = mulberry32(SEED + 1);
		for (let i = 0; i < 40; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const entry = genEntry(r, 1 + int(r, 50));
			const installed = chance(r, 0.2) ? undefined : pick(r, INSTALLED);
			const words = queryWords(tokens(r, SUMMARY_WORDS, 3).join(" "));
			const keys = orderKeys(eco, entry, installed, words);
			expect(keys.noteNumber).toBe(entry.noteNumber);
			expect(keys.markRank).toBe(MARK_RANK[markEntry(eco, entry, installed)]);
			expect(keys.words).toBeGreaterThanOrEqual(0);
			expect(keys.words).toBeLessThanOrEqual(words.length);
			// 12.5 key 1: query words found in the summary and the failure signature.
			const signature =
				entry.kind === "problem" ? entry.failureSignature : undefined;
			const searched =
				signature === undefined
					? entry.summary
					: `${entry.summary}\n${signature}`;
			expect(keys.words).toBe(
				words.filter((w) => countMatches([w], searched) === 1).length,
			);
			if (entry.kind === "problem") {
				expect(keys.balance).toBe(
					entry.confirm.nonBurstTotal - entry.doesNotReproduce.nonBurstTotal,
				);
				expect(keys.time).toBe(
					entry.confirm.lastNonBurstTime ?? entry.timeWritten,
				);
			} else {
				expect(keys.balance).toBe(0);
				expect(keys.time).toBe(entry.timeWritten);
			}
			expect(orderKeys(eco, entry, installed, []).words).toBe(0);
		}
	});

	test("sortEntries returns every entry once, sorted by the keys, whatever the input order", () => {
		const r = mulberry32(SEED + 2);
		for (let i = 0; i < 28; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const entries = genEntries(r, int(r, 24));
			const installed = chance(r, 0.2) ? undefined : pick(r, INSTALLED);
			const query = tokens(r, SUMMARY_WORDS, 3).join(" ");
			const sorted = sortEntries(eco, entries, installed, query);
			expect(sorted.length).toBe(entries.length);
			expect(new Set(sorted).size).toBe(entries.length);
			expect(sorted.map((e) => e.noteNumber).sort((a, b) => a - b)).toEqual(
				entries.map((e) => e.noteNumber),
			);
			const words = queryWords(query);
			for (let k = 1; k < sorted.length; k++) {
				const before = orderKeys(eco, sorted[k - 1] as Entry, installed, words);
				const after = orderKeys(eco, sorted[k] as Entry, installed, words);
				expect(reference(before, after)).toBeLessThan(0);
			}
			const again = sortEntries(eco, shuffled(r, entries), installed, query);
			expect(again.map((e) => e.noteNumber)).toEqual(
				sorted.map((e) => e.noteNumber),
			);
		}
	});

	test("matching the query words ranks an entry first when nothing else differs", () => {
		const r = mulberry32(SEED + 3);
		for (let i = 0; i < 42; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const hit = problemEntry({
				noteNumber: 1 + int(r, 5),
				summary: "stale lock file",
			});
			const miss = problemEntry({
				noteNumber: 10 + int(r, 5),
				summary: "unrelated words",
			});
			const query = pick(r, ["Stale LOCK", "lock", "\uff33tale", "stale file"]);
			const order = sortEntries(
				eco,
				shuffled(r, [hit, miss]),
				undefined,
				query,
			);
			expect(order.map((e) => e.noteNumber)).toEqual([
				hit.noteNumber,
				miss.noteNumber,
			]);
			// Words rank and never filter: the same two entries with no query.
			expect(sortEntries(eco, [hit, miss], undefined, "").length).toBe(2);
		}
	});
});

describe("lookup", () => {
	const SEED = 0x100c0007;
	const KINDS = [
		undefined,
		["problem"],
		["question"],
		["reply"],
		["problem", "reply"],
	] as const;
	const sizes = [0, 1, 9, 10, 11, 20, 21, 35, 60];

	function independentList(
		eco: Ecosystem,
		entries: readonly Entry[],
		kinds: readonly string[] | undefined,
		installed: string | undefined,
		query: string,
	): Entry[] {
		const listed = entries.filter(
			(e) =>
				(kinds === undefined || kinds.includes(e.kind)) &&
				!(e.kind === "reply" && !e.parentGone),
		);
		return sortEntries(eco, listed, installed, query);
	}

	test("the groups concatenated equal the ordered list and conserve the count", () => {
		const r = mulberry32(SEED);
		let multi = 0;
		for (let i = 0; i < 18; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const entries = genEntries(r, pick(r, sizes));
			const unknowns: PageEntry[] = Array.from({ length: int(r, 14) }, () =>
				chance(r, 0.7)
					? {
							status: "unknown-format",
							formatVersion: 2,
							noteNumber: 1 + int(r, 500),
						}
					: { status: "unknown-format", formatVersion: 3 },
			);
			const page = shuffled(r, [...entries.map(okPage), ...unknowns]);
			const kinds = pick(r, KINDS);
			const installed = chance(r, 0.2) ? undefined : pick(r, INSTALLED);
			const query = tokens(r, SUMMARY_WORDS, 2).join(" ");
			const options = {
				...(kinds ? { kinds } : {}),
				...(installed ? { installed } : {}),
				query,
			};
			const want = independentList(eco, entries, kinds, installed, query);
			const got: Entry[] = [];
			let groups = 0;
			for (let g = 0; g < 8; g++) {
				const group = lookupGroup(eco, page, { ...options, group: g });
				expect(group.shown.length).toBeLessThanOrEqual(
					LIMITS.summariesPerGroup,
				);
				expect(group.shown.length + group.notShown).toBe(
					Math.max(0, want.length - g * LIMITS.summariesPerGroup),
				);
				if (group.notShown > 0) {
					expect(group.shown.length).toBe(LIMITS.summariesPerGroup);
				}
				for (const item of group.shown) {
					expect(item.mark).toBe(markEntry(eco, item.entry, installed));
					got.push(item.entry);
				}
				expect(group.unknownFormat.count).toBe(unknowns.length);
				const numbers = unknowns
					.map((u) =>
						u.status === "unknown-format" ? u.noteNumber : undefined,
					)
					.filter((n): n is number => n !== undefined)
					.sort((a, b) => a - b)
					.slice(0, LIMITS.unknownFormatListed);
				expect(group.unknownFormat.noteNumbers).toEqual(numbers);
				groups++;
				if (group.notShown === 0) break;
			}
			if (groups > 1) multi++;
			expect(got.map((e) => e.noteNumber)).toEqual(
				want.map((e) => e.noteNumber),
			);
		}
		expect(multi).toBeGreaterThan(5);
	});

	test("a group past the end is empty and a group that is not a non-negative integer is refused", () => {
		const r = mulberry32(SEED + 1);
		const page = genEntries(r, 25).map(okPage);
		const beyond = lookupGroup("npm", page, { group: 40 });
		expect(beyond.shown).toEqual([]);
		expect(beyond.notShown).toBe(0);
		for (const bad of [-1, 1.5, Number.NaN]) {
			expect(() => lookupGroup("npm", page, { group: bad })).toThrow(
				RangeError,
			);
			expect(() => listReplies([], 1, bad)).toThrow(RangeError);
		}
	});

	test("listReplies lists the replies of one note oldest first, in groups that add up", () => {
		const r = mulberry32(SEED + 2);
		for (let i = 0; i < 40; i++) {
			const parent = 1 + int(r, 3);
			const entries: Entry[] = Array.from({ length: int(r, 40) }, (_, k) => ({
				formatVersion: 1,
				noteNumber: k + 1,
				kind: "reply",
				timeWritten: T0,
				summary: "r",
				warningTags: [],
				parentNoteNumber: 1 + int(r, 3),
				parentGone: chance(r, 0.5),
			}));
			const mine = entries
				.filter((e): e is ReplyEntry => e.kind === "reply")
				.filter((e) => e.parentNoteNumber === parent)
				.map((e) => e.noteNumber);
			const got: number[] = [];
			for (let g = 0; g < 6; g++) {
				const out = listReplies(shuffled(r, entries), parent, g);
				expect(out.shown.length).toBeLessThanOrEqual(LIMITS.repliesPerGroup);
				expect(out.shown.length + out.notShown).toBe(
					Math.max(0, mine.length - g * LIMITS.repliesPerGroup),
				);
				got.push(...out.shown.map((e) => e.noteNumber));
				if (out.notShown === 0) break;
			}
			expect(got).toEqual(mine);
		}
	});
});

// ---------------------------------------------------------- entry and note

const NOTE_KEYS = [
	"formatVersion",
	"kind",
	"summary",
	"whatWasDone",
	"whatHappened",
	"whatWasExpected",
	"workaround",
	"failureSignature",
	"freeText",
	"version",
	"parentNoteNumber",
	"parentGone",
	"noteNumber",
	"timeWritten",
	"warningTags",
];
const ENTRY_KEYS = [
	"replyCount",
	"resolved",
	"reportedVersion",
	"authorObservedVersion",
	"confirm",
	"doesNotReproduce",
	"rows",
	"highestConfirmedVersion",
	"time",
	"total",
	"nonBurstTotal",
	"burst",
	"lastNonBurstTime",
	"confirmTotal",
	"confirmNonBurst",
	"doesNotReproduceTotal",
	"doesNotReproduceNonBurst",
	"entries",
];
const JSON_KEYS = [...NOTE_KEYS, ...ENTRY_KEYS, "__proto__", "constructor", ""];
const JSON_NUMBERS = [
	0,
	1,
	2,
	-1,
	1.5,
	0.1,
	255,
	4096,
	4097,
	2 ** 31,
	2 ** 53 - 1,
	2 ** 53,
	-(2 ** 53),
	1e21,
	1e308,
	1e-7,
	-0,
];
const SIZES = [120, 121, 200, 201, 800, 801, 2000, 2001, 4096, 4097];

function genString(r: Rng): string {
	if (chance(r, 0.1)) {
		return buildExact(
			r,
			chance(r, 0.5) ? KEPT : [...KEPT, ...FORBIDDEN],
			chance(r, 0.5) ? utf8Length : codePointLength,
			pick(r, SIZES),
		);
	}
	return tokens(r, [...KEPT, ...FORBIDDEN, ...DEFAULT_IGNORABLE], 8).join("");
}

function genJson(r: Rng, depth: number): unknown {
	switch (int(r, depth > 0 ? 9 : 6)) {
		case 0:
			return null;
		case 1:
			return chance(r, 0.5);
		case 2:
			return pick(r, JSON_NUMBERS);
		case 3:
		case 4:
			return genString(r);
		case 5:
			return pick(r, ["", "problem", "question", "reply", "npm", "1.0.0", "v"]);
		case 6:
			return Array.from({ length: int(r, 4) }, () => genJson(r, depth - 1));
		default:
			return Object.fromEntries(
				Array.from({ length: int(r, 6) }, () => [
					pick(r, JSON_KEYS),
					genJson(r, depth - 1),
				]),
			);
	}
}

/** The value with a few nested fields replaced, removed or added. */
function perturb(r: Rng, value: unknown, depth: number): unknown {
	if (depth < 0 || typeof value !== "object" || value === null) return value;
	const edit = (child: unknown) =>
		chance(r, 0.07) ? genJson(r, 1) : perturb(r, child, depth - 1);
	if (Array.isArray(value)) {
		return value.filter(() => !chance(r, 0.05)).map(edit);
	}
	const entries = Object.entries(value)
		.filter(() => !chance(r, 0.06))
		.map(([key, child]): [string, unknown] => [key, edit(child)]);
	if (chance(r, 0.1)) entries.push([pick(r, JSON_KEYS), genJson(r, 1)]);
	return Object.fromEntries(entries);
}

const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

type Cap = { bytes: number } | { codePoints: number };
function genField(
	r: Rng,
	cap: Cap,
	singleLine: boolean,
	target?: number,
): string {
	const pool = singleLine ? SINGLE_LINE : KEPT;
	const [limit, measure] =
		"bytes" in cap
			? [cap.bytes, utf8Length]
			: [cap.codePoints, codePointLength];
	const size = target ?? pick(r, [1, 2, limit - 1, limit, 1 + int(r, limit)]);
	return buildExact(r, pool, measure, Math.max(1, Math.min(size, limit)));
}

const FIELD_CAPS = {
	summary: { codePoints: LIMITS.summaryCodePoints },
	failureSignature: { bytes: LIMITS.failureSignatureBytes },
	whatWasDone: { bytes: LIMITS.whatWasDoneBytes },
	whatHappened: { bytes: LIMITS.whatHappenedBytes },
	whatWasExpected: { bytes: LIMITS.whatWasExpectedBytes },
	workaround: { bytes: LIMITS.workaroundBytes },
	freeText: { bytes: LIMITS.freeTextBytes },
} as const;
type FieldName = keyof typeof FIELD_CAPS;
const TEXT_ORDER: FieldName[] = [
	"summary",
	"failureSignature",
	"whatWasDone",
	"whatHappened",
	"whatWasExpected",
	"workaround",
	"freeText",
];
const textBytes = (note: Record<string, unknown>): number =>
	TEXT_ORDER.reduce((n, key) => {
		const v = note[key];
		return n + (typeof v === "string" ? utf8Length(v) : 0);
	}, 0);

/** A note whose every field is within its cap; `full` fills every field to its cap. */
function genNote(
	r: Rng,
	full: boolean,
	only?: NoteContent["kind"],
): Record<string, unknown> {
	const kind = only ?? pick(r, ["problem", "question", "reply"] as const);
	const field = (key: FieldName) =>
		genField(r, FIELD_CAPS[key], key === "summary", full ? 10 ** 6 : undefined);
	const note: Record<string, unknown> = {
		formatVersion: 1,
		kind,
		summary: field("summary"),
	};
	const optional: FieldName[] =
		kind === "problem"
			? ["failureSignature", "whatWasExpected", "workaround", "freeText"]
			: [];
	const required: FieldName[] =
		kind === "problem" ? ["whatWasDone", "whatHappened"] : ["freeText"];
	for (const key of required) note[key] = field(key);
	for (const key of optional)
		if (full || chance(r, 0.5)) note[key] = field(key);
	if (kind !== "reply" && (full || chance(r, 0.5)))
		note.version = validVersion(r);
	if (kind === "reply") note.parentNoteNumber = 1 + int(r, 1000);
	if (!full) {
		// Keep a generated note within the 4096-byte budget by dropping optionals.
		for (const key of optional) {
			if (textBytes(note) > LIMITS.noteTextBytes) delete note[key];
		}
	}
	return note;
}

const published = (r: Rng, note: Record<string, unknown>) => ({
	...note,
	noteNumber: 1 + int(r, 10000),
	timeWritten: int(r, 2 ** 31),
	warningTags: shuffled(r, WARNING_TAGS).slice(0, int(r, 4)),
	...(note.kind === "reply" ? { parentGone: chance(r, 0.5) } : {}),
});

describe("note", () => {
	const SEED = 0x90e70008;

	test("a note the strict writer accepts survives the draft step, a JSON round trip and the lenient reader unchanged", () => {
		const r = mulberry32(SEED);
		let accepted = 0;
		for (let i = 0; i < 40; i++) {
			const note = genNote(r, false);
			const strict = validateWrite(note);
			expect(strict.ok).toBe(true);
			if (!strict.ok) continue;
			accepted++;
			expect(strict.value).toStrictEqual(note as NoteContent);
			expect(validateWrite(wire(note))).toStrictEqual(strict);
			expect(prepareDraft(note)).toStrictEqual(strict);
			const meta = published(r, note);
			expect(readPublishedNote(wire(meta))).toStrictEqual({
				status: "ok",
				value: meta as never,
				cleaned: false,
			});
		}
		expect(accepted).toBe(40);
	});

	test("a field one past its cap, and a note one byte past the total, is refused by the writer and cut by the reader", () => {
		const r = mulberry32(SEED + 1);
		let overTotal = 0;
		for (let i = 0; i < 15; i++) {
			const note = genNote(r, false);
			const key = pick(
				r,
				TEXT_ORDER.filter((k) => typeof note[k] === "string"),
			);
			const cap = FIELD_CAPS[key];
			const longer =
				"bytes" in cap
					? `${genField(r, cap, false, cap.bytes)}a`
					: `${genField(r, cap, true, cap.codePoints)}a`;
			const over = { ...note, [key]: longer };
			const strict = validateWrite(over);
			expect(strict.ok).toBe(false);
			expect(!strict.ok && strict.error).toBe("too-long");
			expect(prepareDraft(over).ok).toBe(false);
			const read = readPublishedNote(published(r, over));
			expect(read.status).toBe("ok");
			if (read.status !== "ok") continue;
			expect(read.cleaned).toBe(true);
			const kept = (read.value as Record<string, unknown>)[key] as string;
			expect(longer.startsWith(kept)).toBe(true);
			expect(
				"bytes" in cap ? utf8Length(kept) : codePointLength(kept),
			).toBeLessThanOrEqual("bytes" in cap ? cap.bytes : cap.codePoints);
		}
		for (let i = 0; i < 30; i++) {
			const note = genNote(r, true, "problem");
			if (textBytes(note) <= LIMITS.noteTextBytes) continue;
			overTotal++;
			const strict = validateWrite(note);
			expect(!strict.ok && strict.error).toBe("too-long");
			const read = readPublishedNote(published(r, note));
			expect(read.status).toBe("ok");
			if (read.status !== "ok") continue;
			expect(read.cleaned).toBe(true);
			expect(
				textBytes(read.value as Record<string, unknown>),
			).toBeLessThanOrEqual(LIMITS.noteTextBytes);
		}
		expect(overTotal).toBeGreaterThan(10);
	});

	test("a summary with a line feed is refused by the writer and read with the line feeds removed", () => {
		const r = mulberry32(SEED + 4);
		for (let i = 0; i < 30; i++) {
			const parts = tokens(r, SINGLE_LINE, 6);
			parts.splice(int(r, parts.length + 1), 0, "\n");
			const summary = parts.join("");
			const bad = { ...genNote(r, false), summary };
			expect(validateWrite(bad)).toEqual({
				ok: false,
				error: "not-conforming",
			});
			expect(prepareDraft(bad)).toEqual({ ok: false, error: "not-conforming" });
			const read = readPublishedNote(published(r, bad));
			expect(read.status).toBe("ok");
			if (read.status !== "ok") continue;
			expect(read.cleaned).toBe(true);
			expect(read.value.summary).toBe(summary.replaceAll("\n", ""));
		}
	});

	test("prepareDraft removes injected forbidden characters and gives back the clean note", () => {
		const r = mulberry32(SEED + 2);
		for (let i = 0; i < 40; i++) {
			const note = genNote(r, false);
			const dirty: Record<string, unknown> = { ...note };
			for (const key of TEXT_ORDER) {
				const text = dirty[key];
				if (typeof text !== "string") continue;
				const chars = [...text];
				for (let k = int(r, 4); k > 0; k--) {
					chars.splice(int(r, chars.length + 1), 0, pick(r, FORBIDDEN));
				}
				dirty[key] = chars.join("");
			}
			expect(prepareDraft(dirty)).toStrictEqual({
				ok: true,
				value: note as NoteContent,
			});
			if (JSON.stringify(dirty) !== JSON.stringify(note)) {
				expect(validateWrite(dirty).ok).toBe(false);
			}
		}
	});

	test("no reader or writer throws on arbitrary JSON, and what the lenient reader returns is clean and within its caps", () => {
		const r = mulberry32(SEED + 3);
		let readable = 0;
		for (let i = 0; i < 60; i++) {
			const seedNote = published(r, genNote(r, chance(r, 0.2)));
			const value = chance(r, 0.15)
				? genJson(r, 3)
				: chance(r, 0.3)
					? wire(seedNote)
					: perturb(r, wire(seedNote), 2);
			for (const run of [validateWrite, prepareDraft]) {
				const result = run(value);
				expect(typeof result.ok).toBe("boolean");
				if (result.ok) {
					expect(validateWrite(result.value)).toStrictEqual(result);
				}
			}
			const read = readPublishedNote(value);
			expect(["ok", "unknown-format", "unparseable"]).toContain(read.status);
			if (read.status !== "ok") continue;
			readable++;
			const out = read.value as Record<string, unknown>;
			for (const key of TEXT_ORDER) {
				const text = out[key];
				if (text === undefined) continue;
				expect(typeof text).toBe("string");
				expect(isConforming(text as string)).toBe(true);
				const cap = FIELD_CAPS[key];
				if ("bytes" in cap) {
					expect(utf8Length(text as string)).toBeLessThanOrEqual(cap.bytes);
				} else {
					expect(codePointLength(text as string)).toBeLessThanOrEqual(
						cap.codePoints,
					);
					expect(text).not.toContain("\n");
				}
			}
			expect(textBytes(out)).toBeLessThanOrEqual(LIMITS.noteTextBytes);
			const tags = out.warningTags as string[];
			expect(new Set(tags).size).toBe(tags.length);
			for (const tag of tags)
				expect(WARNING_TAGS as readonly string[]).toContain(tag);
		}
		expect(readable).toBeGreaterThan(15);
	});
});

/** An entry the strict validator accepts: its table comes out of deriveStatus. */
function genValidEntry(r: Rng, eco: Ecosystem, noteNumber: number): Entry {
	const summary = genField(r, FIELD_CAPS.summary, true);
	const base = {
		formatVersion: 1,
		noteNumber,
		timeWritten: int(r, 2 ** 31),
		summary,
		warningTags: shuffled(r, WARNING_TAGS).slice(0, int(r, 6)),
	} as const;
	const resolved = chance(r, 0.3)
		? {
				time: int(r, 2 ** 31),
				...(chance(r, 0.5) ? { version: validVersion(r) } : {}),
			}
		: undefined;
	const roll = int(r, 6);
	if (roll === 0) {
		return {
			...base,
			kind: "reply",
			parentNoteNumber: 1 + int(r, 1000),
			parentGone: chance(r, 0.5),
		};
	}
	if (roll === 1) {
		return {
			...base,
			kind: "question",
			replyCount: int(r, 5),
			...(resolved ? { resolved } : {}),
			...(chance(r, 0.5) ? { version: validVersion(r) } : {}),
		};
	}
	const status = deriveStatus(
		eco,
		genVotes(r, chance(r, 0.4)),
		pick(r, [LIMITS.versionRows, 3]),
	);
	const entry = problemEntry({
		...base,
		replyCount: int(r, 5),
		confirm: status.confirm,
		doesNotReproduce: status.doesNotReproduce,
		rows: status.rows,
		...(resolved ? { resolved } : {}),
		...(status.highestConfirmedVersion !== undefined
			? { highestConfirmedVersion: status.highestConfirmedVersion }
			: {}),
		...(chance(r, 0.5)
			? { failureSignature: genField(r, FIELD_CAPS.failureSignature, false) }
			: {}),
		...(chance(r, 0.5) ? { reportedVersion: validVersion(r) } : {}),
		...(chance(r, 0.3) ? { authorObservedVersion: validVersion(r) } : {}),
	});
	return entry;
}

describe("entry", () => {
	const SEED = 0xe47a0009;

	test("an entry the strict validator accepts reads back unchanged, also after a JSON round trip", () => {
		const r = mulberry32(SEED);
		const kinds = new Set<string>();
		for (let i = 0; i < 42; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const entry = genValidEntry(r, eco, 1 + i);
			kinds.add(entry.kind);
			for (const value of [entry, wire(entry)]) {
				expect(validateEntry(eco, value)).toStrictEqual({
					ok: true,
					value: entry,
				});
				expect(readEntry(value)).toStrictEqual({
					status: "ok",
					value: entry,
					cleaned: false,
				});
			}
		}
		expect([...kinds].sort()).toEqual(["problem", "question", "reply"]);
	});

	test("a summary or signature past its cap is refused when strict and cut at the cap when lenient", () => {
		const r = mulberry32(SEED + 1);
		for (let i = 0; i < 70; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const entry = problemEntry({ noteNumber: 1 + i });
			const summary = buildExact(r, SINGLE_LINE, codePointLength, 121);
			const signature = buildExact(r, KEPT, utf8Length, 201);
			const over = {
				...entry,
				summary,
				failureSignature: `${signature}\u{1f600}`,
			};
			const strict = validateEntry(eco, over);
			expect(strict.ok).toBe(false);
			const read = readEntry(over);
			expect(read.status).toBe("ok");
			if (read.status !== "ok" || read.value.kind !== "problem") continue;
			expect(read.cleaned).toBe(true);
			expect(summary.startsWith(read.value.summary)).toBe(true);
			expect(codePointLength(read.value.summary)).toBe(
				LIMITS.summaryCodePoints,
			);
			const kept = read.value.failureSignature as string;
			expect(over.failureSignature.startsWith(kept)).toBe(true);
			expect(utf8Length(kept)).toBeLessThanOrEqual(
				LIMITS.failureSignatureBytes,
			);
			expect(kept.isWellFormed()).toBe(true);
			expect(validateEntry(eco, read.value).ok).toBe(true);
		}
	});

	test("a digest page of the limit size is read, one more entry is not, and an unknown entry is listed by number", () => {
		const r = mulberry32(SEED + 2);
		const entries = Array.from(
			{ length: LIMITS.entriesPerDigestPage + 1 },
			(_, i) => genValidEntry(r, "npm", 1 + i),
		);
		for (const n of [
			0,
			1,
			LIMITS.entriesPerDigestPage - 1,
			LIMITS.entriesPerDigestPage,
		]) {
			const page = readDigestPage(
				wire({ formatVersion: 1, entries: entries.slice(0, n) }),
			);
			expect(page.status).toBe("ok");
			if (page.status !== "ok") continue;
			expect(page.cleaned).toBe(false);
			expect(page.entries.length).toBe(n);
		}
		expect(readDigestPage({ formatVersion: 1, entries }).status).toBe(
			"unparseable",
		);
		const mixed = readDigestPage({
			formatVersion: 1,
			entries: [entries[0], { formatVersion: 2, noteNumber: 77 }, entries[1]],
		});
		expect(mixed).toStrictEqual({
			status: "ok",
			entries: [
				okPage(entries[0] as Entry),
				{ status: "unknown-format", formatVersion: 2, noteNumber: 77 },
				okPage(entries[1] as Entry),
			],
			cleaned: false,
		});
		expect(readDigestPage({ formatVersion: 2, entries: [] })).toEqual({
			status: "unknown-format",
			formatVersion: 2,
		});
		expect(readDigestPage({ formatVersion: 1, entries: [1] }).status).toBe(
			"unparseable",
		);
	});

	test("no entry reader or validator throws on arbitrary JSON, and everything they accept is consistent", () => {
		const r = mulberry32(SEED + 3);
		let strictOk = 0;
		let lenientOk = 0;
		for (let i = 0; i < 65; i++) {
			const eco = pick(r, ECOSYSTEMS);
			const entry = genValidEntry(r, eco, 1 + int(r, 500));
			const value = chance(r, 0.15)
				? genJson(r, 3)
				: chance(r, 0.3)
					? wire(entry)
					: perturb(r, wire(entry), 3);
			const strict = validateEntry(eco, value);
			if (strict.ok) {
				strictOk++;
				// What the service accepts, the client reads back untouched.
				expect(readEntry(wire(strict.value))).toStrictEqual({
					status: "ok",
					value: strict.value,
					cleaned: false,
				});
				expect(validateEntry(eco, strict.value)).toStrictEqual(strict);
			}
			const read = readEntry(value);
			expect(["ok", "unknown-format", "unparseable"]).toContain(read.status);
			readDigestPage({ formatVersion: 1, entries: [value, value] });
			if (read.status !== "ok") continue;
			lenientOk++;
			const e = read.value;
			expect(isConforming(e.summary)).toBe(true);
			expect(e.summary).not.toContain("\n");
			expect(codePointLength(e.summary)).toBeLessThanOrEqual(
				LIMITS.summaryCodePoints,
			);
			expect(new Set(e.warningTags).size).toBe(e.warningTags.length);
			if (e.kind === "problem") {
				expect(e.rows.length).toBeLessThanOrEqual(LIMITS.versionRows);
				if (e.failureSignature !== undefined) {
					expect(isConforming(e.failureSignature)).toBe(true);
					expect(utf8Length(e.failureSignature)).toBeLessThanOrEqual(
						LIMITS.failureSignatureBytes,
					);
				}
				for (const row of e.rows)
					expect(isValidVersion(row.version)).toBe(true);
			}
		}
		expect(strictOk).toBeGreaterThan(10);
		expect(lenientOk).toBeGreaterThan(20);
	});
	test("the lenient readers keep the first occurrence of each known tag, and the strict entry check refuses anything else", () => {
		const r = mulberry32(SEED + 4);
		const pool = [...WARNING_TAGS, "bogus", ""];
		const known = WARNING_TAGS as readonly string[];
		for (let i = 0; i < 60; i++) {
			const tags = tokens(r, pool, 8);
			const want: string[] = [];
			for (const tag of tags) {
				if (known.includes(tag) && !want.includes(tag)) want.push(tag);
			}
			const entry = {
				...problemEntry({ noteNumber: 1 + i }),
				warningTags: tags,
			};
			const read = readEntry(entry);
			expect(read.status).toBe("ok");
			if (read.status === "ok") {
				expect(read.value.warningTags as string[]).toEqual(want);
			}
			const note = readPublishedNote({
				...published(r, genNote(r, false)),
				warningTags: tags,
			});
			expect(note.status).toBe("ok");
			if (note.status === "ok") {
				expect(note.value.warningTags as string[]).toEqual(want);
			}
			// Strict: only a list of known, distinct tags passes.
			expect(validateEntry("npm", entry).ok).toBe(tags.length === want.length);
		}
	});
	test("a summary with a line feed is refused when strict and read with the line feeds removed", () => {
		const r = mulberry32(SEED + 5);
		for (let i = 0; i < 30; i++) {
			const parts = tokens(r, SINGLE_LINE, 6);
			parts.splice(int(r, parts.length + 1), 0, "\n");
			const summary = parts.join("");
			const entry = { ...problemEntry({ noteNumber: 1 + i }), summary };
			expect(validateEntry("npm", entry).ok).toBe(false);
			const read = readEntry(entry);
			expect(read.status).toBe("ok");
			if (read.status !== "ok") continue;
			expect(read.cleaned).toBe(true);
			expect(read.value.summary).toBe(summary.replaceAll("\n", ""));
		}
	});
});
