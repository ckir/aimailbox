# Agent Mailbox Core (plan 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, shared core of the agent mailbox: canonical box addresses, text and version rules, the note and digest formats with their validation, status data, marks and order, each with tests.

**Architecture:** One package, as now. Everything in this plan lives in `src/core/`, one file per responsibility with its test beside it. Core code has no I/O, no dependency and no Bun-only API, so the later client (`src/client/`) and service (`src/service/`) import the same modules (spec 6.2 rule 2). No workspace, and no change to `tsconfig.json`, `justfile`, `lefthook.yml` or the toolchain suite.

**Tech Stack:** TypeScript on Bun 1.4.4 (Unicode 17.0), `bun:test`, Biome, `tsc --noEmit`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-23-agent-mailbox-design.md` (revision 7, approved 2026-11-24). Section numbers below refer to it. Executors read both.

**What exists now (verified 2026-11-24):** `src/index.ts` (one exported constant) and `src/index.test.ts`; neither is touched. There is no `src/core/` and no `scripts/` directory. Every other path in this plan is created by it.

## Where the decisions in this plan come from

The spec leaves the layout, the field layout and every unmeasured size to the builder (section 15). Those calls were agreed with the second agent in one agreement round on 2026-11-24 (brief `.clavity/seams/agent-mailbox-plan1-agreement-first.md`, reply `.clavity/scratch/agent-mailbox-plan1-agreement/reply.md`, in the working copy, not committed): one point agreed, six amended by the second agent, all amendments accepted and checked. They are the builder's calls, not the owner's rulings.

Measured for this plan:

- `Bun.semver.order("1.2", "1.2.0")` returns 1 without error and `"01.2.3"` equals `"1.2.3"`, so it is not strict. Task 3 writes its own Semantic Versioning 2.0.0 parser.
- JavaScript has no full case folding (`"ß".toLowerCase()` is `"ß"`), so Task 2 checks in a table.
- `/^[a-z]$/iu` matches U+017F, so every name pattern here is ASCII-only with no `i` flag.
- Name rules were read at the sources: npm `validate-npm-package-name` `lib/index.js` (8.0.0), PyPA "Names and normalization", crates.io `crates_io_validation/src/lib.rs`, Go `golang.org/x/mod/module` `CheckPath` and `go.dev/ref/mod`, `semver/semver` `semver.md`.

## Global Constraints

- Bun only: `bun test`, `bun run --bun`; tasks run through `just` (`just test`, `just typecheck`, `just lint`, `just fmt`, `just check-fast`).
- Product tests live next to the code in `src/` (project `CLAUDE.md`).
- No new dependency, no new config file, no change to gated files (`justfile`, `lefthook.yml`, `.lefthook/`, `tsconfig.json`, `biome.json`, `package.json`).
- Core production files import nothing but other `src/core/` files: no `bun:*`, no `node:*`, no `fetch`, no file or clock access. Time is always an argument.
- `tsconfig.json` has `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `allowImportingTsExtensions`: import with the `.ts` extension and `import type` for types.
- Never commit a token-shaped literal. No test in this plan needs a secret.
- Test code compares a `Result` or `ReadResult` with a plain literal through `expect<unknown>(…)`: `toEqual` is typed from the value under test, and `just typecheck` (run by the pre-commit hook) rejects the plain form wherever the literal is wider than the union (an `error: string` parameter, an untyped fixture).
- In source files every invisible, private-use, unassigned or look-alike character is written as a `\u` escape, never as the character itself. The only non-ASCII characters typed literally in tests are `é`, `è`, `û`, `ß` and `😀`.
- Every size is `[PROPOSED, UNMEASURED]` and lives only in `src/core/limits.ts`; no other file holds a number from that list.
- A property whose value is `undefined` is treated as absent everywhere (JSON never carries one); several tests build objects that way.
- Rejected, never repaired: a name, version or field that fails a rule is refused; nothing is trimmed or corrected on the write side (6.2 rule 7, 7.1, 12.1).
- Run `just fmt` before `just lint`. Commit after every task with the attribution line the session gives.
- Branch: `design/agent-mailbox` holds the spec and this plan. Execution starts on a new branch from it (or from `main` once it is merged). Do not push or open a pull request without asking the owner.

## Out of this plan, and where each lands

- How a signal changes stored votes (one vote per key, one counted vote per range, fixed and restored arrival times, the burst window and its end points, the author's key and range): the service plan. The 13.1 "Votes" tests go with it.
- Reading lock files and `go.mod`: the client lookup plan. This plan has only the rule "one distinct recorded version, else unknown".
- The warning-tag rule set, the scanner, signals, flags, retractions, the write identifier, manifests, the catalogue, the alias file, signatures and the exact signed bytes: the plans that build them. They may wrap these objects in an envelope and may not change their fields.
- File names that keep case-distinct boxes apart on macOS: the client store plan.
- The rendered one-line status summary of 12.3 (size-capped, empty fields omitted, counts, burst flag and resolved mark always shown): the client lookup plan, which prints. This plan fixes only the data it is rendered from.
- Offering the existing boxes that differ only by case when a bare `npm` name is typed (6.2 rule 7, last sentence) and resolving bare names (6.2 rule 6): the client lookup plan; both need the catalogue.
- "A reply never answers a reply" (6.1 rule 5): the service plan, which knows the kind of the parent. This plan checks only that `parentNoteNumber` is a positive safe integer.

## Review Focus

1. A lone surrogate or an unassigned code point inside otherwise valid text: stripped on the client, refused by strict validation, never thrown on (Task 1, Task 6).
2. A number that is an integer but not a safe one (`1e30`), or negative, in any count, time or note number: unparseable, never accepted (Task 6, Task 7).
3. An address that changes again when canonicalised twice (`…/v2/v3`, `repo.git.git`, `pkg.v2.v3`): refused, so `canonicalise(c) === c` for every accepted output (Task 5).
4. A version that is valid text but not orderable inside an orderable box (`1.2`, `latest`): equality only, never ordered, never thrown on (Task 3, Task 9).
5. A digest entry in a newer format version, or a row the table dropped: listed by identifier only, or contributing to no mark; neither crashes a lookup (Task 7, Task 9, Task 10).

Each line has its test in the task named.

---

## File Structure

| File                               | Responsibility                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/core/limits.ts`               | Every size and threshold, the format version, the tag vocabulary                                            |
| `src/core/result.ts`               | The `Result` and `ReadResult` types                                                                         |
| `src/core/ecosystem.ts`            | The closed prefix list and which prefixes order versions                                                    |
| `src/core/text.ts`                 | Line ends, forbidden characters, byte and code-point caps (7.1)                                             |
| `src/core/casefold-data.ts`        | Generated full case folding table, Unicode 17.0.0                                                           |
| `src/core/fold.ts`                 | The normalised copy of 7.4, words, query words, matching (12.5 key 1)                                       |
| `src/core/version.ts`              | 12.1 charset, leading `v`, strict SemVer, order, equality, row key, installed version                       |
| `src/core/address.ts`              | Canonical addresses (6.2 rule 7) and note identifiers                                                       |
| `src/core/note.ts`                 | Note content and published note: draft preparation, strict write check, lenient read                        |
| `src/core/entry.ts`                | Digest entry and page: shapes, strict check, lenient read                                                   |
| `src/core/status.ts`               | Status data from current counted votes, row dropping (12.3)                                                 |
| `src/core/mark.ts`                 | The five marks (12.4)                                                                                       |
| `src/core/order.ts`                | The five order keys (12.5)                                                                                  |
| `src/core/lookup.ts`               | Which entries a lookup lists, groups, unknown formats, reply lists (6.1 rule 6, 7.1, 7.2, 9.6 rule 6)       |
| `scripts/generate-case-folding.ts` | Dev-only generator for `casefold-data.ts` (not type-checked: outside `tsconfig` `include`; linted by Biome) |

Shared types used across tasks (defined in the task named, repeated here once so every implementer sees the same names):

```ts
// result.ts (Task 1)
export type Result<T, E extends string = string> =
	| { ok: true; value: T }
	| { ok: false; error: E };
export type ReadResult<T> =
	| { status: "ok"; value: T; cleaned: boolean } // cleaned: something was stripped or cut (7.1 notice)
	| { status: "unknown-format"; formatVersion: number; noteNumber?: number }
	| { status: "unparseable" };

// ecosystem.ts (Task 1)
export const ECOSYSTEMS = ["npm", "cargo", "go", "pypi", "tool"] as const;
export type Ecosystem = (typeof ECOSYSTEMS)[number];
export function ordersVersions(ecosystem: Ecosystem): boolean; // true for npm, cargo, go
```

---

### Task 1: Limits, result types, ecosystems and text rules (7.1)

**Files:**

- Create: `src/core/limits.ts`, `src/core/result.ts`, `src/core/ecosystem.ts`, `src/core/text.ts`
- Test: `src/core/text.test.ts`, `src/core/ecosystem.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `Result`, `ReadResult`, `ECOSYSTEMS`, `Ecosystem`, `ordersVersions` as above, and:

```ts
// limits.ts — exact values; every one is [PROPOSED, UNMEASURED] except where the spec is cited
export const FORMAT_VERSION = 1;
export const WARNING_TAGS = [
	"network-or-install",
	"config-or-credential",
	"disables-check",
	"indirect-execution",
	"edits-executable",
] as const;
export type WarningTag = (typeof WARNING_TAGS)[number];
export const LIMITS = {
	summaryCodePoints: 120, // spec 7
	failureSignatureBytes: 200,
	whatWasDoneBytes: 800,
	whatHappenedBytes: 800,
	whatWasExpectedBytes: 400,
	workaroundBytes: 800,
	freeTextBytes: 2000,
	noteTextBytes: 4096, // all text fields of one note together
	versionChars: 64, // spec 12.1
	rawAddressBytes: 1024,
	addressBytes: 256,
	versionRows: 16,
	entriesPerDigestPage: 50,
	summariesPerGroup: 10, // spec 7
	repliesPerGroup: 10,
	unknownFormatListed: 10,
	queryWords: 8,
	notReproducedThreshold: 3, // spec 12.4
} as const;

// text.ts
export function normalizeLineEnds(text: string): string; // "\r\n" and lone "\r" -> "\n"
export function stripForbidden(text: string): string; // line ends first, then remove forbidden characters
export function isConforming(text: string): boolean; // stripForbidden(text) === text
export function utf8Length(text: string): number;
export function codePointLength(text: string): number;
export function cutToBytes(text: string, maxBytes: number): string; // never splits a code point
export function cutToCodePoints(text: string, maxCodePoints: number): string;
```

Forbidden characters are exactly the Unicode general categories Cc (except U+000A and U+0009), Cf, Cs, Co, Cn, Zl and Zp, from the runtime's `\p{…}` with the `u` flag. A lone surrogate is Cs and is removed; a surrogate pair forming an assigned character is kept. Text is never put into a normal form.

- [ ] **Step 1: Write the failing tests** in `src/core/text.test.ts` and `src/core/ecosystem.test.ts`

```ts
// text.test.ts
import { expect, test } from "bun:test";
import {
	cutToBytes,
	cutToCodePoints,
	codePointLength,
	isConforming,
	normalizeLineEnds,
	stripForbidden,
	utf8Length,
} from "./text.ts";

test("each line-end form becomes one line feed", () => {
	expect(normalizeLineEnds("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
	expect(normalizeLineEnds("a\r\r\nb")).toBe("a\n\nb");
});
test("each forbidden category is removed, newline and tab are kept", () => {
	expect(stripForbidden("a\u0000b")).toBe("ab"); // Cc
	expect(stripForbidden("a\u001b[31mb")).toBe("a[31mb"); // Cc: escape
	expect(stripForbidden("a\u200bb\u202eb")).toBe("abb"); // Cf: zero width, bidi override
	expect(stripForbidden("a\ud800b")).toBe("ab"); // Cs: lone surrogate
	expect(stripForbidden("a\ue000b")).toBe("ab"); // Co
	expect(stripForbidden("a\u0378b")).toBe("ab"); // Cn
	expect(stripForbidden("a\u2028b\u2029c")).toBe("abc"); // Zl, Zp
	expect(stripForbidden("a\tb\nc")).toBe("a\tb\nc");
	expect(stripForbidden("a\r\nb")).toBe("a\nb");
});
test("a lone carriage return becomes a line feed before anything is removed", () => {
	expect(stripForbidden("a\u000db")).toBe("a\u000ab");
	expect(stripForbidden("a\u000d\u000d\u000ab")).toBe("a\u000a\u000ab");
});
test("an astral character is kept and text is not normalised", () => {
	expect(stripForbidden("ok 😀")).toBe("ok 😀");
	expect(stripForbidden("e\u0301")).toBe("e\u0301");
	expect(stripForbidden("\ufb01")).toBe("\ufb01");
});
test("isConforming is false for a carriage return and for a forbidden character", () => {
	expect(isConforming("a\rb")).toBe(false);
	expect(isConforming("a\u200bb")).toBe(false);
	expect(isConforming("a\tb\nc é 😀")).toBe(true);
});
test("lengths and cuts count the right unit and never split a code point", () => {
	expect(utf8Length("é😀")).toBe(6);
	expect(codePointLength("é😀")).toBe(2);
	expect(cutToBytes("aé😀", 2)).toBe("a"); // é needs bytes 2..3
	expect(cutToBytes("aé😀", 3)).toBe("aé");
	expect(cutToBytes("aé😀", 6)).toBe("aé"); // 😀 needs 4 more
	expect(cutToBytes("aé😀", 7)).toBe("aé😀");
	expect(cutToCodePoints("a😀b", 2)).toBe("a😀");
	expect(cutToBytes("abc", 0)).toBe("");
});
```

```ts
// ecosystem.test.ts
import { expect, test } from "bun:test";
import { ECOSYSTEMS, ordersVersions } from "./ecosystem.ts";

test("the prefix list is closed and three prefixes order versions", () => {
	expect([...ECOSYSTEMS].sort()).toEqual([
		"cargo",
		"go",
		"npm",
		"pypi",
		"tool",
	]);
	expect(ECOSYSTEMS.filter(ordersVersions).sort()).toEqual([
		"cargo",
		"go",
		"npm",
	]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test src/core/text.test.ts src/core/ecosystem.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `limits.ts`, `result.ts`, `ecosystem.ts` exactly as in Interfaces, and implement `text.ts`**

`utf8Length` uses `TextEncoder`. `cutToBytes` walks code points with `for…of` and stops before the one that would pass the limit.

- [ ] **Step 4: Run the tests and the gates**

Run: `bun test src/core && just fmt && just typecheck && just lint`
Expected: all tests pass; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/core && git commit -m "Add limits, result types and the stored-text rules of the mailbox core"
```

---

### Task 2: The normalised copy and word matching (7.4, 12.5 key 1)

**Files:**

- Create: `scripts/generate-case-folding.ts`, `src/core/casefold-data.ts` (generated), `src/core/fold.ts`
- Test: `src/core/fold.test.ts`

**Interfaces:**

- Consumes: `LIMITS.queryWords`.
- Produces:

```ts
// casefold-data.ts (generated; do not edit by hand)
export const CASE_FOLDING_UNICODE_VERSION = "17.0.0";
export const CASE_FOLDING: ReadonlyMap<number, string>; // code point -> folded string, statuses C and F only

// fold.ts
export function foldText(text: string): string; // NFKC, full case fold, NFKC again
export function wordsOf(text: string): string[]; // foldText, then split on /[^\p{L}\p{Nd}]+/u, empty strings dropped
export function queryWords(query: string): string[]; // first LIMITS.queryWords unique words of wordsOf(query), first-appearance order
export function countMatches(words: readonly string[], text: string): number; // how many distinct `words` are among wordsOf(text)
```

The folded copy is never stored or shown. Word boundaries follow 12.5 literally: any code point that is not a letter (`\p{L}`) or a decimal digit (`\p{Nd}`). A combining mark is therefore a boundary; that is recorded as a known consequence, not fixed here.

- [ ] **Step 1: Write the generator** `scripts/generate-case-folding.ts`

It takes two arguments, the path of a downloaded `CaseFolding.txt` and the path of the file to write; it reads the version from the first line (`# CaseFolding-17.0.0.txt`), keeps the lines whose status is `C` or `F`, and writes to the second path (it prints nothing but one line naming the version and the number of entries) a TypeScript file in the shape above (a `new Map<number, string>([[0x41, "a"], …])` with `\u{…}` escapes for every mapped string, sorted by code point, under a header comment naming the source URL and version). It does not fetch anything.

- [ ] **Step 2: Generate the table**

```bash
UCD="$(mktemp -d)" # a scratch directory outside the repository
curl -sS -o "$UCD/CaseFolding.txt" https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt
sha256sum "$UCD/CaseFolding.txt"
bun run scripts/generate-case-folding.ts "$UCD/CaseFolding.txt" src/core/casefold-data.ts
```

Expected checksum: `ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183`. If it differs, stop and report; do not generate.

- [ ] **Step 3: Write the failing tests** in `src/core/fold.test.ts`

```ts
import { expect, test } from "bun:test";
import { CASE_FOLDING, CASE_FOLDING_UNICODE_VERSION } from "./casefold-data.ts";
import { countMatches, foldText, queryWords, wordsOf } from "./fold.ts";

test("the table is the Unicode 17.0.0 C and F mappings", () => {
	expect(CASE_FOLDING_UNICODE_VERSION).toBe("17.0.0");
	expect(CASE_FOLDING.size).toBe(1585); // 1481 C + 104 F
	expect(CASE_FOLDING.get(0xdf)).toBe("ss");
	expect(CASE_FOLDING.get(0x130)).toBe("i\u0307");
	expect(CASE_FOLDING.get(0x212a)).toBe("k");
});
test("the runtime's Unicode version matches the table", () => {
	// Fails when Bun moves to a newer Unicode: regenerate the table from that version's file.
	expect(
		CASE_FOLDING_UNICODE_VERSION.startsWith(`${process.versions.unicode}.`),
	).toBe(true);
});
test("a look-alike spelling folds to the plain one", () => {
	expect(foldText("CURL")).toBe("curl");
	expect(foldText("\uff43\uff55\uff52\uff4c")).toBe("curl"); // full-width
	expect(foldText("\ufb01le")).toBe("file"); // ligature
	expect(foldText("Straße")).toBe("strasse");
	expect(foldText("\u017fudo")).toBe("sudo"); // long s
	expect(foldText("\u0390")).toBe(foldText("\u0399\u0308\u0301")); // needs the second NFKC
});
test("words split on anything that is not a letter or decimal digit", () => {
	expect(wordsOf("npm install --save foo_bar2")).toEqual([
		"npm",
		"install",
		"save",
		"foo",
		"bar2",
	]);
	expect(wordsOf("  ")).toEqual([]);
	expect(wordsOf("Crème brûlée")).toEqual(["crème", "brûlée"]);
});
test("query words are unique, in first-appearance order, at most eight", () => {
	expect(queryWords("Lock LOCK file")).toEqual(["lock", "file"]);
	expect(queryWords("a b c d e f g h i j")).toEqual([
		"a",
		"b",
		"c",
		"d",
		"e",
		"f",
		"g",
		"h",
	]);
});
test("duplicates are removed before the first eight are taken", () => {
	expect(queryWords("a a b c d e f g h i")).toEqual([
		"a",
		"b",
		"c",
		"d",
		"e",
		"f",
		"g",
		"h",
	]);
});
test("matching is on whole words and counts distinct query words", () => {
	expect(countMatches(["lock", "file"], "Lockfile and a LOCK")).toBe(1);
	expect(countMatches(["lock", "file"], "the lock file, the lock")).toBe(2);
	expect(countMatches([], "anything")).toBe(0);
});
```

- [ ] **Step 4: Run to see them fail**, then implement `fold.ts`

Run: `bun test src/core/fold.test.ts` — expected FAIL (`fold.ts` not found), then PASS after implementing. `foldText` maps each code point through `CASE_FOLDING` (unmapped code points stay), between two `normalize("NFKC")` calls.

- [ ] **Step 5: Gates and commit**

Run: `just fmt && just typecheck && just lint && bun test src/core`
Expected: clean, all pass. `just fmt` reformats the generated file, so the committed file is the formatted one; never hand-edit its entries, regenerate instead.

```bash
git add scripts src/core && git commit -m "Add the folded copy of text and word matching to the mailbox core"
```

---

### Task 3: Versions (12.1, 12.4)

**Files:**

- Create: `src/core/version.ts`
- Test: `src/core/version.test.ts`

**Interfaces:**

- Consumes: `Ecosystem`, `ordersVersions`, `Result`, `LIMITS.versionChars`.
- Produces:

```ts
export function isValidVersion(text: string): boolean; // 12.1: 1..64 of [A-Za-z0-9.\-+_~:!]
export function stripLeadingV(version: string): string; // removes exactly one leading "v", if present
export function canOrder(ecosystem: Ecosystem, version: string): boolean; // ordersVersions && isValidVersion && strict SemVer 2.0.0 after stripLeadingV
export function compareVersions(
	ecosystem: Ecosystem,
	a: string,
	b: string,
): -1 | 0 | 1 | undefined; // undefined unless both canOrder
export function versionsEqual(
	ecosystem: Ecosystem,
	a: string,
	b: string,
): boolean;
export function rowKey(ecosystem: Ecosystem, version: string): string; // stripLeadingV; "+build" removed when canOrder
export function resolveInstalled(
	ecosystem: Ecosystem,
	explicit: string | undefined,
	recorded: readonly string[],
): Result<string | undefined, "invalid-version">;
```

Rules:

- Strict grammar: the `semver.md` BNF. `major.minor.patch` are numeric identifiers with no leading zero; pre-release identifiers are non-empty `[0-9A-Za-z-]`, numeric ones with no leading zero; build identifiers are non-empty `[0-9A-Za-z-]`.
- Precedence: major, minor, patch numerically (compare as `BigInt` or by length then text, so long numbers do not lose precision); a pre-release sorts before its release; pre-release identifiers left to right, all-digit ones numerically, others in ASCII order, numeric below non-numeric, fewer fields below more when all earlier ones are equal; build metadata ignored.
- `versionsEqual`: when both `canOrder`, precedence is 0; otherwise the strings are equal after `stripLeadingV`.
- `resolveInstalled`: an explicit version that fails `isValidVersion` is `{ ok: false, error: "invalid-version" }`; a valid one is returned as given. With no explicit version: `tool` gives `undefined`; any recorded version failing `isValidVersion` gives `undefined`; otherwise the recorded versions are grouped by `versionsEqual`, and exactly one group gives its first member, anything else `undefined`.

- [ ] **Step 1: Write the failing tests** in `src/core/version.test.ts`

```ts
import { expect, test } from "bun:test";
import {
	canOrder,
	compareVersions,
	isValidVersion,
	resolveInstalled,
	rowKey,
	stripLeadingV,
	versionsEqual,
} from "./version.ts";

test("the version charset and length", () => {
	expect(isValidVersion("1.2.3")).toBe(true);
	expect(isValidVersion("1!2.0~rc1+local_x:y")).toBe(true);
	expect(isValidVersion("")).toBe(false);
	expect(isValidVersion("1.2 3")).toBe(false);
	expect(isValidVersion("1.2/3")).toBe(false);
	expect(isValidVersion("1.2é")).toBe(false);
	expect(isValidVersion("1".repeat(64))).toBe(true);
	expect(isValidVersion("1".repeat(65))).toBe(false);
});
test("one leading v is removed, not two", () => {
	expect(stripLeadingV("v1.2.3")).toBe("1.2.3");
	expect(stripLeadingV("vv1")).toBe("v1");
	expect(stripLeadingV("1.2.3")).toBe("1.2.3");
});
test("only strict SemVer in npm, cargo and go can be ordered", () => {
	for (const ok of [
		"1.2.3",
		"v1.2.3",
		"0.0.0",
		"1.0.0-alpha.1",
		"1.0.0-0.3.7",
		"1.0.0+20130313144700",
		"1.0.0-beta+exp.sha.5114f85",
		"1.0.0--",
	])
		expect(canOrder("npm", ok)).toBe(true);
	for (const bad of [
		"1.2",
		"1",
		"01.2.3",
		"1.02.3",
		"1.2.3-",
		"1.2.3-01",
		"1.2.3-a..b",
		"1.2.3+",
		"1.2.3+a..b",
		"latest",
		"1.2.3.4",
		"vv1.2.3",
		"1.2.3 ",
		"1!1.2.3",
	])
		expect(canOrder("npm", bad)).toBe(false);
	expect(canOrder("cargo", "1.2.3")).toBe(true);
	expect(canOrder("go", "v1.2.3")).toBe(true);
	expect(canOrder("pypi", "1.2.3")).toBe(false);
	expect(canOrder("tool", "1.2.3")).toBe(false);
});
test("a version too long for 12.1 is never ordered", () => {
	expect(canOrder("npm", `1.0.0-${"a".repeat(58)}`)).toBe(true); // 64 characters
	expect(canOrder("npm", `1.0.0-${"a".repeat(59)}`)).toBe(false);
});
test("precedence follows Semantic Versioning 2.0.0", () => {
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
	for (let i = 0; i + 1 < chain.length; i++) {
		expect(
			compareVersions("npm", chain[i] as string, chain[i + 1] as string),
		).toBe(-1);
		expect(
			compareVersions("npm", chain[i + 1] as string, chain[i] as string),
		).toBe(1);
	}
	expect(compareVersions("npm", "1.10.0", "1.9.0")).toBe(1);
	expect(compareVersions("npm", "1.0.0-1", "1.0.0-a")).toBe(-1);
	expect(
		compareVersions(
			"npm",
			"99999999999999999999.0.0",
			"100000000000000000000.0.0",
		),
	).toBe(-1);
});
test("non-numeric identifiers compare in ASCII order and long numeric ones exactly", () => {
	expect(compareVersions("npm", "1.0.0-Z", "1.0.0-a")).toBe(-1);
	expect(compareVersions("npm", "1.0.0-a-", "1.0.0-a0")).toBe(-1);
	expect(
		compareVersions(
			"npm",
			"1.0.0-99999999999999999999",
			"1.0.0-100000000000000000000",
		),
	).toBe(-1);
});
test("v1.2.3 equals 1.2.3 and orders; build metadata is ignored", () => {
	expect(compareVersions("go", "v1.2.3", "1.2.3")).toBe(0);
	expect(compareVersions("npm", "1.2.3+a", "1.2.3+b")).toBe(0);
	expect(versionsEqual("npm", "v1.2.3+a", "1.2.3")).toBe(true);
	expect(compareVersions("npm", "1.2", "1.2.0")).toBeUndefined();
	expect(compareVersions("pypi", "1.2.3", "1.2.4")).toBeUndefined();
});
test("the two pairs of spec section 4 are not comparable", () => {
	expect(compareVersions("pypi", "1.0.post1", "1.0.1")).toBeUndefined();
	expect(compareVersions("npm", "1.0.post1", "1.0.1")).toBeUndefined();
	expect(compareVersions("tool", "2:1.0-1", "1:2.0-1")).toBeUndefined();
	expect(compareVersions("npm", "2:1.0-1", "1:2.0-1")).toBeUndefined();
});
test("where versions cannot be ordered, equality is on the whole string after one v", () => {
	expect(versionsEqual("pypi", "v1.2.3", "1.2.3")).toBe(true);
	expect(versionsEqual("pypi", "1.2.3+a", "1.2.3")).toBe(false);
	expect(versionsEqual("npm", "1.2", "1.2.0")).toBe(false);
	expect(versionsEqual("npm", "latest", "vlatest")).toBe(true);
});
test("the row key drops one v, and the build part only where versions order", () => {
	expect(rowKey("npm", "v1.2.0+a")).toBe("1.2.0");
	expect(rowKey("npm", "1.0.0-rc.1+x")).toBe("1.0.0-rc.1");
	expect(rowKey("pypi", "v1.2.0+a")).toBe("1.2.0+a");
	expect(rowKey("npm", "v1.2+a")).toBe("1.2+a");
});
test("the installed version", () => {
	expect<unknown>(resolveInstalled("npm", "1.2.3", ["9.9.9"])).toEqual({
		ok: true,
		value: "1.2.3",
	});
	expect<unknown>(resolveInstalled("npm", "1.2 3", [])).toEqual({
		ok: false,
		error: "invalid-version",
	});
	expect<unknown>(resolveInstalled("npm", undefined, ["1.2.3"])).toEqual({
		ok: true,
		value: "1.2.3",
	});
	expect<unknown>(
		resolveInstalled("npm", undefined, ["1.2.3", "v1.2.3+b"]),
	).toEqual({
		ok: true,
		value: "1.2.3",
	});
	expect<unknown>(
		resolveInstalled("npm", undefined, ["1.2.3", "1.2.4"]),
	).toEqual({
		ok: true,
		value: undefined,
	});
	expect<unknown>(resolveInstalled("npm", undefined, [])).toEqual({
		ok: true,
		value: undefined,
	});
	expect<unknown>(
		resolveInstalled("npm", undefined, ["1.2.3", "bad version"]),
	).toEqual({
		ok: true,
		value: undefined,
	});
	expect<unknown>(resolveInstalled("tool", undefined, ["1.2.3"])).toEqual({
		ok: true,
		value: undefined,
	});
	expect<unknown>(resolveInstalled("tool", "2024-01", [])).toEqual({
		ok: true,
		value: "2024-01",
	});
});
```

- [ ] **Step 2: Run to see them fail**

Run: `bun test src/core/version.test.ts` — expected FAIL, module not found.

- [ ] **Step 3: Implement `version.ts`** to the rules above.

- [ ] **Step 4: Run tests and gates**

Run: `bun test src/core && just fmt && just typecheck && just lint` — expected: all pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src/core && git commit -m "Add version rules and strict semantic version ordering to the mailbox core"
```

---

### Task 4: Canonical addresses for npm, pypi and cargo, and note identifiers (6.2)

**Files:**

- Create: `src/core/address.ts`
- Test: `src/core/address.test.ts`

**Interfaces:**

- Consumes: `Ecosystem`, `ECOSYSTEMS`, `Result`, `LIMITS.rawAddressBytes`, `LIMITS.addressBytes`.
- Produces:

```ts
export type AddressError = "too-long" | "unknown-prefix" | "bad-name";
export function canonicalise(input: string): Result<string, AddressError>;
export function isCanonical(address: string): boolean; // canonicalise succeeds and returns the same string
export function ecosystemOf(canonicalAddress: string): Ecosystem; // throws on a non-canonical address
export function formatNoteId(
	canonicalAddress: string,
	noteNumber: number,
): string; // "<address>#<number>"
export function parseNoteId(
	id: string,
): Result<{ address: string; noteNumber: number }, "bad-note-id">;
```

Rules for this task (the `go` and `tool` branches return `bad-name` until Task 5):

- Input is `<prefix>/<name>`. Checks run in this order, first failure wins: input longer than 1024 UTF-8 bytes is `too-long` (before the prefix is looked at); then the prefix; then the name; then a result longer than 256 bytes is `too-long`. A prefix that is not exactly one of the five lowercase words, or no `/`: `unknown-prefix`. Everything else that fails: `bad-name`.
- Lowercasing is of ASCII `A-Z` only. Every pattern is ASCII-only with no `i` or `u` flag.
- `npm`: `name` or `@scope/name`. Each part matches `/^[A-Za-z0-9._~-]+$/`; no part starts with `.`; an unscoped name does not start with `-` or `_`; the whole name, scope included, is at most 214 characters and is not `node_modules` or `favicon.ico` in any ASCII case. Case is kept. The registry's validator marks six characters as allowed in old names only: `~ ' ! ( ) *`. `~` is accepted here; the other five are refused, so a package named with one has no box.
- `pypi`: must match `/^([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9])$/` before rewriting; then lowercase with every run of `-`, `_`, `.` written as one `-`.
- `cargo`: must match `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/` before rewriting; then lowercase with `_` written as `-`.
- A note identifier is `<address>#<number>`: the address must be canonical; the number matches `/^[1-9][0-9]*$/` and is a safe integer. `formatNoteId` throws on a non-canonical address or a number that is not a positive safe integer.

- [ ] **Step 1: Write the failing tests** in `src/core/address.test.ts`

```ts
import { expect, test } from "bun:test";
import {
	canonicalise,
	ecosystemOf,
	formatNoteId,
	isCanonical,
	parseNoteId,
} from "./address.ts";

const ok = (input: string, out: string) =>
	expect<unknown>(canonicalise(input)).toEqual({ ok: true, value: out });
const bad = (input: string, error = "bad-name") =>
	expect<unknown>(canonicalise(input)).toEqual({ ok: false, error });

test("prefixes are a closed lowercase list", () => {
	bad("gem/rails", "unknown-prefix");
	bad("NPM/left-pad", "unknown-prefix");
	bad("left-pad", "unknown-prefix");
	bad("", "unknown-prefix");
	bad(`npm/${"a".repeat(1100)}`, "too-long");
});
test("the length checks: raw input first, the result last", () => {
	bad(`gem/${"a".repeat(1100)}`, "too-long");
	bad(`pypi/${"a".repeat(300)}`, "too-long");
	ok(`pypi/${"a".repeat(251)}`, `pypi/${"a".repeat(251)}`); // 5 + 251 = 256 bytes
	bad(`pypi/${"a".repeat(252)}`, "too-long");
});
test("npm keeps case, so MEAN and mean are two boxes", () => {
	ok("npm/MEAN", "npm/MEAN");
	ok("npm/mean", "npm/mean");
	ok("npm/@biomejs/biome", "npm/@biomejs/biome");
	ok("npm/@Scope/Pkg.js", "npm/@Scope/Pkg.js");
	ok("npm/a~b", "npm/a~b");
});
test("npm refuses what the registry's validator refuses, and the legacy characters", () => {
	for (const name of [
		"",
		".hidden",
		"-x",
		"_x",
		"@scope/.x",
		"@/x",
		"@scope/",
		"@scope",
		"a/b",
		"@a/b/c",
		"a b",
		"a!",
		"it's",
		"f(x)",
		"a*",
		"café",
		"node_modules",
		"Node_Modules",
		"favicon.ico",
		"a".repeat(215),
	])
		bad(`npm/${name}`);
	ok(`npm/${"a".repeat(214)}`, `npm/${"a".repeat(214)}`);
	ok("npm/@scope/-x", "npm/@scope/-x"); // the validator checks a leading - and _ on the whole name only
});
test("pypi is lowercased and runs of - _ . become one -", () => {
	ok("pypi/Friendly-Bard", "pypi/friendly-bard");
	ok("pypi/FRIENDLY.bard", "pypi/friendly-bard");
	ok("pypi/friendly__--..bard", "pypi/friendly-bard");
	ok("pypi/a", "pypi/a");
	for (const name of ["", "-a", "a-", ".a", "a_", "a b", "\u017fix", "a/b"])
		bad(`pypi/${name}`);
});
test("cargo is lowercased and _ becomes -", () => {
	ok("cargo/Serde_JSON", "cargo/serde-json");
	ok("cargo/a", "cargo/a");
	ok(`cargo/${"a".repeat(64)}`, `cargo/${"a".repeat(64)}`);
	for (const name of [
		"",
		"1abc",
		"_abc",
		"-abc",
		"a.b",
		"a b",
		"é",
		"a".repeat(65),
	])
		bad(`cargo/${name}`);
});
test("a canonical address stays the same, and isCanonical says so", () => {
	for (const input of [
		"npm/MEAN",
		"npm/@a/b",
		"pypi/Friendly.Bard",
		"cargo/Serde_JSON",
	]) {
		const once = canonicalise(input);
		if (!once.ok) throw new Error(input);
		expect<unknown>(canonicalise(once.value)).toEqual(once);
		expect(isCanonical(once.value)).toBe(true);
	}
	expect(isCanonical("pypi/Friendly.Bard")).toBe(false);
	expect(isCanonical("cargo/serde_json")).toBe(false);
	expect(ecosystemOf("npm/@a/b")).toBe("npm");
	expect(() => ecosystemOf("cargo/serde_json")).toThrow();
});
test("formatNoteId refuses a number that is not a positive safe integer", () => {
	for (const n of [0, -1, 1.5, 2 ** 53, Number.NaN])
		expect(() => formatNoteId("npm/a", n)).toThrow();
	expect(formatNoteId("npm/a", 2 ** 53 - 1)).toBe("npm/a#9007199254740991");
});
test("note identifiers", () => {
	expect(formatNoteId("npm/@a/b", 41)).toBe("npm/@a/b#41");
	expect<unknown>(parseNoteId("npm/@a/b#41")).toEqual({
		ok: true,
		value: { address: "npm/@a/b", noteNumber: 41 },
	});
	for (const id of [
		"npm/@a/b",
		"npm/@a/b#",
		"npm/@a/b#0",
		"npm/@a/b#041",
		"npm/@a/b#-1",
		"npm/@a/b#1.5",
		"npm/@a/b#99999999999999999999",
		"cargo/serde_json#1",
		"npm/a#1#2",
	])
		expect<unknown>(parseNoteId(id)).toEqual({
			ok: false,
			error: "bad-note-id",
		});
	expect(() => formatNoteId("cargo/serde_json", 1)).toThrow();
	expect(() => formatNoteId("npm/a", 0)).toThrow();
});
```

- [ ] **Step 2: Run to see them fail** — `bun test src/core/address.test.ts`, expected FAIL, module not found.

- [ ] **Step 3: Implement `address.ts`** with one private function per prefix, each returning `string | undefined`; `go` and `tool` return `undefined` for now.

- [ ] **Step 4: Run tests and gates** — `bun test src/core && just fmt && just typecheck && just lint`, expected all pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src/core && git commit -m "Add canonical box addresses for npm, pypi and cargo and note identifiers"
```

---

### Task 5: Canonical addresses for go and tool (6.2 rule 7)

**Files:**

- Modify: `src/core/address.ts` (the `go` and `tool` branches left by Task 4)
- Test: `src/core/address-go-tool.test.ts`

**Interfaces:**

- Consumes: Task 4's `canonicalise`, `isCanonical`.
- Produces: no new name; `canonicalise` now accepts `go/…` and `tool/…`.

Rules:

- `go`: split the name on `/`. Every element is non-empty, matches `/^[A-Za-z0-9._~-]+$/`, does not begin or end with `.`, and its part before the first `.` is not one of `CON PRN AUX NUL COM1`–`COM9` `LPT1`–`LPT9` in any ASCII case and does not end in `~` followed by digits. The first element is lowercased and must then match `/^[a-z0-9.-]+$/`, contain a `.` and not start with `-`. The rest keeps its case.
  - First element `gopkg.in`: 2 or 3 elements in all. If the last element matches `/\.v[0-9]+(\..*)?$/`, the suffix must be exactly `.v0` or `.v[1-9][0-9]*` (so `.v01` and `.v2.1` are refused) and is removed; a path with no such suffix is accepted as it is. After removal the last element must still pass every element rule and must not itself end in `.v[0-9]+`.
  - Any other host, and only when the path has two or more elements (the host element is never read as a version): a final element that is `v0`, `v1`, `v0[0-9]+` or `v[0-9]+\..*` is refused. A final element `v[1-9][0-9]*` with a value of 2 or more is removed. After removal, if two or more elements remain, the new final element must not match `/^v[0-9]+(\..*)?$/`.
- `tool`: parsed by hand; the `URL` class is not used because it repairs `.` and `..` segments. The name is read as exactly one of three forms, tried in this order. (1) URL: it starts with `<scheme>://` where the scheme is `https`, `http`, `ssh` or `git` in any ASCII case; any other `<letters>://` start is refused. Remove everything from the first `#`, then everything from the first `?`. Split the rest at the first `/` into authority and path; no `/` is refused. In the authority only: if it contains `@` it must contain exactly one, with a non-empty part before it, and that part and the `@` are removed; then one trailing `:` followed by one or more digits is removed. What is left is the host. (2) Remote: the name contains `@`. Split at the first `@` into user and rest; the user is non-empty and has none of `/ : ? # @` or whitespace; the rest must contain `:` and is split at the first `:` into host and path; the path has no `?` or `#`. The remote form has no port: digits after the colon are a path element. (3) Plain: split at the first `/` into host and path; no `/` is refused. Then, for all three: lowercase host and path; remove all trailing `/` from the path; remove one trailing `.git`; refuse if the path is then empty or still ends in `.git` or `/`. The host is two or more labels joined by `.`, each matching `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`. The path is one or more elements, each matching `/^[a-z0-9._~-]+$/` and not `.` or `..`.
- For every accepted input, `canonicalise(result) === result`.

- [ ] **Step 1: Write the failing tests** in `src/core/address-go-tool.test.ts`

```ts
import { expect, test } from "bun:test";
import { canonicalise, isCanonical } from "./address.ts";

const ok = (input: string, out: string) => {
	expect<unknown>(canonicalise(input)).toEqual({ ok: true, value: out });
	expect<unknown>(canonicalise(out)).toEqual({ ok: true, value: out }); // idempotent
	expect(isCanonical(out)).toBe(true);
};
const bad = (input: string) =>
	expect<unknown>(canonicalise(input)).toEqual({
		ok: false,
		error: "bad-name",
	});

test("go lowercases the host only and keeps the path's case", () => {
	ok(
		"go/GitHub.com/Azure/azure-sdk-for-go",
		"go/github.com/Azure/azure-sdk-for-go",
	);
	ok("go/example.com/M", "go/example.com/M");
	ok("go/example.com/m", "go/example.com/m");
	ok("go/golang.org/x/mod", "go/golang.org/x/mod");
	ok("go/example.com", "go/example.com");
});
test("go major versions share one box", () => {
	ok("go/github.com/a/b/v2", "go/github.com/a/b");
	ok("go/github.com/a/b/v15", "go/github.com/a/b");
	ok("go/example.com/v2", "go/example.com");
	for (const p of [
		"github.com/a/b/v0",
		"github.com/a/b/v1",
		"github.com/a/b/v02",
		"github.com/a/b/v2.1",
		"github.com/a/b/v2/v3",
		"github.com/a/b/v1/v2",
	])
		bad(`go/${p}`);
	ok("go/github.com/a/v2x", "go/github.com/a/v2x"); // not a version element
});
test("a host that looks like a version is still a host", () => {
	ok("go/v8.dev", "go/v8.dev");
	ok("go/v0.dev", "go/v0.dev");
	ok("go/v0.dev/pkg", "go/v0.dev/pkg");
	ok("go/v2.example.com/v2", "go/v2.example.com");
});
test("gopkg.in paths lose .vN and stay canonical without it", () => {
	ok("go/gopkg.in/yaml.v2", "go/gopkg.in/yaml");
	ok("go/gopkg.in/yaml.v0", "go/gopkg.in/yaml");
	ok("go/gopkg.in/user/pkg.v3", "go/gopkg.in/user/pkg");
	ok("go/gopkg.in/yaml", "go/gopkg.in/yaml");
	for (const p of [
		"gopkg.in",
		"gopkg.in/a/b/c.v1",
		"gopkg.in/yaml.v02",
		"gopkg.in/yaml.v2.1",
		"gopkg.in/pkg..v2",
		"gopkg.in/pkg.v2.v3",
	])
		bad(`go/${p}`);
});
test("go refuses what CheckPath refuses", () => {
	for (const p of [
		"",
		"example",
		"-a.com/x",
		"example.com/",
		"/example.com",
		"example.com//x",
		"example.com/.x",
		"example.com/x.",
		"example.com/..",
		"example.com/a b",
		"example.com/café",
		"example.com/CON",
		"example.com/con.txt",
		"example.com/Lpt1",
		"example.com/exampl~1.go",
		"exa_mple.com/x",
		"example.com/x?y",
	])
		bad(`go/${p}`);
	ok("go/example.com/a~b", "go/example.com/a~b");
	ok("go/example.com/con1", "go/example.com/con1");
});
test("every form of one upstream gives one tool address", () => {
	const want = "tool/github.com/org/repo";
	for (const input of [
		"github.com/org/repo",
		"GitHub.com/Org/Repo",
		"https://github.com/org/repo",
		"HTTPS://github.com/org/repo.git",
		"https://user:pw@github.com:443/org/repo.git/?a=b#frag",
		"ssh://git@github.com/org/repo.git",
		"git://github.com/org/repo",
		"git@github.com:org/repo.git",
		"http://github.com/org/repo///",
	])
		ok(`tool/${input}`, want);
	ok(
		"tool/gitlab.com/group/sub/proj_1.x~y",
		"tool/gitlab.com/group/sub/proj_1.x~y",
	);
});
test("tool reads user and port from the authority only", () => {
	for (const input of [
		"https://github.com/org/repo:443",
		"https://github.com/org/a@evil.com/x",
		"https://@github.com/org/repo",
		"https://a@b@github.com/org/repo",
		"https://github.com:/org/repo",
		"https://github.com",
		"a@b@github.com:org/repo",
		"git@github.com/org/repo",
		"github.com/org/a@b",
	])
		bad(`tool/${input}`);
});
test("the remote form has no port: digits after the colon are a path element", () => {
	ok("tool/git@github.com:443/org/repo.git", "tool/github.com/443/org/repo");
});
test("tool refuses, never repairs", () => {
	for (const input of [
		"",
		"github.com",
		"github.com/",
		"localhost/x",
		"https://github.com/org/../repo",
		"github.com/org/./repo",
		"github.com//repo",
		"github.com/org/repo.git.git",
		"github.com/org/.git",
		"ftp://github.com/org/repo",
		"https://github.com:port/org/repo",
		".github.com/x",
		"github.com./x",
		"git..hub.com/x",
		"-a.com/x",
		"a-.com/x",
		"github.com/org/re po",
		"github.com/org/café",
		"github.com/org/repo!",
		"@github.com:org/repo",
		"a b@github.com:org/repo",
		"git@github.com:org/repo?x",
	])
		bad(`tool/${input}`);
});
```

- [ ] **Step 2: Run to see them fail** — `bun test src/core/address-go-tool.test.ts`, expected FAIL (every `ok` case returns `bad-name`).

- [ ] **Step 3: Implement the `go` and `tool` branches** to the rules above.

- [ ] **Step 4: Run tests and gates** — `bun test src/core && just fmt && just typecheck && just lint`, expected all pass (Task 4's tests included), clean.

- [ ] **Step 5: Commit**

```bash
git add src/core && git commit -m "Add canonical box addresses for go modules and upstream tools"
```

---

### Task 6: Note content and the published note (6.1 rule 5, 7.1)

**Files:**

- Create: `src/core/note.ts`
- Test: `src/core/note.test.ts`

**Interfaces:**

- Consumes: `text.ts`, `isValidVersion`, `LIMITS`, `FORMAT_VERSION`, `WARNING_TAGS`, `WarningTag`, `Result`, `ReadResult`.
- Produces:

```ts
export type ProblemContent = {
	formatVersion: 1; kind: "problem"; summary: string; whatWasDone: string; whatHappened: string;
	version?: string; whatWasExpected?: string; workaround?: string; failureSignature?: string; freeText?: string;
};
export type QuestionContent = { formatVersion: 1; kind: "question"; summary: string; freeText: string; version?: string };
export type ReplyContent = { formatVersion: 1; kind: "reply"; summary: string; parentNoteNumber: number; freeText: string };
export type NoteContent = ProblemContent | QuestionContent | ReplyContent;
type PublishedMeta = { noteNumber: number; timeWritten: number; warningTags: WarningTag[] };
export type PublishedNote =
	| (ProblemContent & PublishedMeta)
	| (QuestionContent & PublishedMeta)
	| (ReplyContent & PublishedMeta & { parentGone: boolean }); // required on a reply; an unknown field on the other kinds

export type NoteError = "not-an-object" | "unknown-format" | "unknown-field" | "bad-kind" | "missing-field" | "bad-type" | "bad-number" | "bad-version" | "not-conforming" | "too-long";
export function prepareDraft(input: unknown): Result<NoteContent, NoteError>; // client, before the scan (7.1 first rule)
export function validateWrite(value: unknown): Result<NoteContent, NoteError>; // service: accept unchanged or reject (7.1 second rule)
export function readPublishedNote(value: unknown): ReadResult<PublishedNote>; // client on reading (7.1 third rule)
export const TEXT_FIELD_ORDER: readonly ["summary", "failureSignature", "whatWasDone", "whatHappened", "whatWasExpected", "workaround", "freeText"];
```

Rules, shared:

- JSON objects. `formatVersion` is a positive safe integer; note numbers are positive safe integers; times are non-negative safe integers. An absent optional field is omitted: `null` and `""` are errors on the write side.
- Caps: `summary` 120 code points and no line feed; the six other text fields by their byte caps in `LIMITS`; all text fields of one note together at most 4096 bytes. The text fields are the seven of `TEXT_FIELD_ORDER`; `version` is not one of them: `prepareDraft` does not strip it and it does not count toward the total.
- `version` must pass `isValidVersion`; a `version` that is not a string, or is `""`, is `bad-version` on the write side (not `bad-type`).

`prepareDraft`: applies `stripForbidden` to every text field of the input, then runs the same checks as `validateWrite`. It never cuts: an over-long field is `too-long`.

`validateWrite`, checked in this order, first failure wins: not a plain object → `not-an-object`; `formatVersion` not exactly 1 → `unknown-format`; `kind` not one of three → `bad-kind`; a key the kind does not define → `unknown-field`; a required field absent → `missing-field`; a text field that is not a string, or a required one that is empty, or an optional one present but empty → `bad-type`; `parentNoteNumber` not a positive safe integer → `bad-number`; `version` failing 12.1 → `bad-version`; any text field for which `isConforming` is false, or a line feed in `summary` → `not-conforming`; any cap exceeded → `too-long`. On success the value is returned with the same fields and values.

`readPublishedNote`:

- not a plain object, or `formatVersion` missing, not a safe integer or below 1 → `unparseable`;
- `formatVersion` greater than 1 → `unknown-format`, with `noteNumber` when the object carries a positive safe integer there; no other field is looked at;
- for version 1: a wrong type, an unknown `kind`, a missing required field, a bad number, a `version` failing 12.1, a text field (required or optional) that is already `""` in the object, `warningTags` not an array of strings, or on a reply `parentGone` absent or not a boolean → `unparseable`. On a problem or question `parentGone` is an unknown field;
- unknown fields are dropped; warning tags outside the vocabulary are dropped; neither sets `cleaned`;
- every text field is passed through `stripForbidden`, line feeds are removed from `summary`, each field is cut to its own cap, then the fields are taken in `TEXT_FIELD_ORDER` and each gets at most what is left of the 4096-byte budget (so only `freeText` can be shortened by it). `cleaned` is true when any of that changed a field. A required text field emptied by stripping stays present as `""`; an optional one emptied by stripping is omitted; both set `cleaned`.

- [ ] **Step 1: Write the failing tests** in `src/core/note.test.ts`

```ts
import { expect, test } from "bun:test";
import { prepareDraft, readPublishedNote, validateWrite } from "./note.ts";

const problem = {
	formatVersion: 1,
	kind: "problem",
	summary: "install fails on a lock file",
	whatWasDone: "ran install",
	whatHappened: "exit 1",
};
const question = {
	formatVersion: 1,
	kind: "question",
	summary: "how to pin?",
	freeText: "which flag pins a version?",
};
const reply = {
	formatVersion: 1,
	kind: "reply",
	summary: "use --exact",
	parentNoteNumber: 41,
	freeText: "pass --exact",
};
const err = (value: unknown, error: string) =>
	expect<unknown>(validateWrite(value)).toEqual({ ok: false, error });

test("each kind is accepted unchanged with its required fields", () => {
	for (const note of [problem, question, reply])
		expect<unknown>(validateWrite(note)).toEqual({ ok: true, value: note });
	const full = {
		...problem,
		version: "v1.2.0",
		whatWasExpected: "exit 0",
		workaround: "delete the lock",
		failureSignature: "E_LOCK",
		freeText: "more",
	};
	expect<unknown>(validateWrite(full)).toEqual({ ok: true, value: full });
	expect<unknown>(validateWrite({ ...question, version: "1.0" }).ok).toBe(true);
});
test("strict validation rejects, in the stated order", () => {
	err(null, "not-an-object");
	err([], "not-an-object");
	err({ ...problem, formatVersion: 2 }, "unknown-format");
	err({ ...problem, formatVersion: "1" }, "unknown-format");
	err({ ...problem, kind: "rant" }, "bad-kind");
	err({ ...problem, extra: 1 }, "unknown-field");
	err({ ...question, whatWasDone: "x" }, "unknown-field");
	err({ ...reply, version: "1.0" }, "unknown-field");
	err(
		{ formatVersion: 1, kind: "problem", summary: "s", whatWasDone: "d" },
		"missing-field",
	);
	err({ formatVersion: 1, kind: "question", summary: "s" }, "missing-field");
	err({ ...problem, summary: 7 }, "bad-type");
	err({ ...problem, summary: "" }, "bad-type");
	err({ ...problem, workaround: "" }, "bad-type");
	err({ ...problem, workaround: null }, "bad-type");
	for (const n of [0, -1, 1.5, 1e30, "41"])
		err({ ...reply, parentNoteNumber: n }, "bad-number");
	err({ ...problem, version: "1.2 3" }, "bad-version");
	err({ ...problem, whatHappened: "a\u200bb" }, "not-conforming");
	err({ ...problem, whatHappened: "a\r\nb" }, "not-conforming");
	err({ ...problem, whatHappened: "a\ud800b" }, "not-conforming");
	err({ ...problem, summary: "two\nlines" }, "not-conforming");
});
test("caps: the summary in code points, the rest in bytes, and the total", () => {
	expect<unknown>(
		validateWrite({ ...problem, summary: "😀".repeat(120) }).ok,
	).toBe(true);
	err({ ...problem, summary: "a".repeat(121) }, "too-long");
	expect<unknown>(
		validateWrite({ ...problem, whatWasDone: "a".repeat(800) }).ok,
	).toBe(true);
	err({ ...problem, whatWasDone: "a".repeat(801) }, "too-long");
	err({ ...problem, whatWasDone: "é".repeat(401) }, "too-long");
	err({ ...problem, failureSignature: "a".repeat(201) }, "too-long");
	err({ ...problem, whatWasExpected: "a".repeat(401) }, "too-long");
	err({ ...problem, freeText: "a".repeat(2001) }, "too-long");
	const big = {
		...problem,
		summary: "s",
		whatWasDone: "a".repeat(800),
		whatHappened: "a".repeat(800),
		workaround: "a".repeat(800),
		freeText: "a".repeat(1695),
	};
	expect<unknown>(validateWrite(big).ok).toBe(true); // 1 + 800 * 3 + 1695 = 4096
	err({ ...big, freeText: "a".repeat(1696) }, "too-long");
});
test("the first failure in the stated order wins, and every byte cap is its own", () => {
	err({ ...problem, formatVersion: 2, kind: "rant" }, "unknown-format");
	err({ ...problem, kind: "rant", extra: 1 }, "bad-kind");
	err({ ...problem, extra: 1, summary: "" }, "unknown-field");
	err({ ...reply, parentNoteNumber: 0, freeText: "a\u200b" }, "bad-number");
	err(
		{ ...problem, version: "1 2", whatHappened: "a".repeat(801) },
		"bad-version",
	);
	err(
		{ ...problem, whatHappened: `\u200b${"a".repeat(801)}` },
		"not-conforming",
	);
	err({ ...problem, whatHappened: "a".repeat(801) }, "too-long");
	err({ ...problem, workaround: "a".repeat(801) }, "too-long");
	err({ ...question, freeText: "a".repeat(2001) }, "too-long");
});
test("a version that is not a non-empty string is a bad version, not a bad type", () => {
	err({ ...problem, version: "" }, "bad-version");
	err({ ...problem, version: 5 }, "bad-version");
	err({ ...question, version: null }, "bad-version");
});
test("a draft with a forbidden character is fixed without it; an over-long one is refused", () => {
	expect<unknown>(
		prepareDraft({ ...problem, whatHappened: "exit\u200b 1\r\nagain" }),
	).toEqual({ ok: true, value: { ...problem, whatHappened: "exit 1\nagain" } });
	expect<unknown>(
		prepareDraft({ ...problem, whatWasDone: "a".repeat(801) }),
	).toEqual({
		ok: false,
		error: "too-long",
	});
	expect<unknown>(prepareDraft({ ...problem, summary: "\u200b" })).toEqual({
		ok: false,
		error: "bad-type",
	});
});

const published = {
	...problem,
	noteNumber: 41,
	timeWritten: 1_700_000_000,
	warningTags: ["network-or-install"],
};
test("reading a conforming note returns it, not cleaned", () => {
	expect<unknown>(readPublishedNote(published)).toEqual({
		status: "ok",
		value: published,
		cleaned: false,
	});
	expect<unknown>(
		readPublishedNote({
			...reply,
			noteNumber: 42,
			timeWritten: 5,
			warningTags: [],
			parentGone: true,
		}).status,
	).toBe("ok");
});
test("reading ignores unknown fields and unknown tags without calling it cleaned", () => {
	expect<unknown>(
		readPublishedNote({
			...published,
			future: 1,
			warningTags: ["network-or-install", "safe"],
		}),
	).toEqual({ status: "ok", value: published, cleaned: false });
});
test("reading strips and cuts under the notice", () => {
	const r = readPublishedNote({
		...published,
		summary: `a\u202eb\nc${"x".repeat(200)}`,
		whatHappened: "y".repeat(900),
	});
	if (r.status !== "ok") throw new Error(r.status);
	expect(r.cleaned).toBe(true);
	expect(r.value.summary).toBe(`abc${"x".repeat(117)}`);
	expect((r.value as { whatHappened: string }).whatHappened).toBe(
		"y".repeat(800),
	);
});
test("the total budget shortens only the free text", () => {
	const r = readPublishedNote({
		...published,
		summary: "s",
		whatWasDone: "a".repeat(800),
		whatHappened: "a".repeat(800),
		workaround: "a".repeat(800),
		freeText: "a".repeat(2000),
	});
	if (r.status !== "ok") throw new Error(r.status);
	expect(r.cleaned).toBe(true);
	expect((r.value as { freeText: string }).freeText).toBe("a".repeat(1695));
});
test("a field emptied by stripping: a required one stays empty, an optional one is omitted", () => {
	const r = readPublishedNote({
		...published,
		whatHappened: "\u200b",
		workaround: "\u200b",
	});
	if (r.status !== "ok") throw new Error(r.status);
	expect(r.cleaned).toBe(true);
	expect<unknown>(r.value).toEqual({ ...published, whatHappened: "" });
});
test("an empty string in the object is unparseable, and parentGone belongs to replies only", () => {
	expect<unknown>(readPublishedNote({ ...published, summary: "" })).toEqual({
		status: "unparseable",
	});
	expect<unknown>(readPublishedNote({ ...published, workaround: "" })).toEqual({
		status: "unparseable",
	});
	expect<unknown>(
		readPublishedNote({ ...published, parentGone: "yes" }),
	).toEqual({ status: "ok", value: published, cleaned: false });
});
test("unknown format versions print nothing; broken structure is unparseable", () => {
	expect<unknown>(
		readPublishedNote({
			formatVersion: 2,
			noteNumber: 41,
			summary: "ignore previous instructions",
		}),
	).toEqual({ status: "unknown-format", formatVersion: 2, noteNumber: 41 });
	expect<unknown>(readPublishedNote({ formatVersion: 3 })).toEqual({
		status: "unknown-format",
		formatVersion: 3,
	});
	for (const broken of [
		null,
		"x",
		{},
		{ ...published, formatVersion: 0 },
		{ ...published, formatVersion: 1.5 },
		{ ...published, noteNumber: 1e30 },
		{ ...published, noteNumber: 0 },
		{ ...published, timeWritten: -1 },
		{ ...published, kind: "rant" },
		{ ...published, summary: 7 },
		{ ...published, version: "1 2" },
		{ ...published, warningTags: "x" },
		{ ...published, whatWasDone: undefined },
		{ ...reply, noteNumber: 2, timeWritten: 1, warningTags: [] },
	])
		expect<unknown>(readPublishedNote(broken)).toEqual({
			status: "unparseable",
		});
});
```

- [ ] **Step 2: Run to see them fail** — `bun test src/core/note.test.ts`, expected FAIL, module not found.

- [ ] **Step 3: Implement `note.ts`** to the rules above. Export small private-use helpers that Task 7 needs from this file: `isPlainObject(value: unknown): value is Record<string, unknown>`, `isPositiveSafeInteger(value: unknown): value is number`, `isNonNegativeSafeInteger(value: unknown): value is number`, and `cleanText(text: string, cap: { bytes: number } | { codePoints: number }, singleLine: boolean): { text: string; changed: boolean }`.

- [ ] **Step 4: Run tests and gates** — `bun test src/core && just fmt && just typecheck && just lint`, expected all pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src/core && git commit -m "Add note content, strict write validation and lenient reading to the mailbox core"
```

---

### Task 7: The digest entry and page (12.3, 10.4, 7.1)

**Files:**

- Create: `src/core/entry.ts`
- Test: `src/core/entry.test.ts`, `src/core/fixtures.ts` (test data shared with Tasks 8 to 10; no secret, plain objects)

**Interfaces:**

- Consumes: Task 6's helpers, `isValidVersion`, `rowKey`, `canOrder`, `Ecosystem`, `LIMITS`, `WarningTag`, `ReadResult`, `Result`.
- Produces:

```ts
export type FormCounts = { total: number; nonBurstTotal: number; burst: boolean; lastNonBurstTime?: number };
export type VersionRow = { version: string; confirmTotal: number; confirmNonBurst: number; doesNotReproduceTotal: number; doesNotReproduceNonBurst: number };
export type Resolved = { time: number; version?: string };
type EntryBase = { formatVersion: 1; noteNumber: number; timeWritten: number; summary: string; warningTags: WarningTag[] };
export type ProblemEntry = EntryBase & {
	kind: "problem"; replyCount: number; resolved?: Resolved; failureSignature?: string;
	reportedVersion?: string; authorObservedVersion?: string;
	confirm: FormCounts; doesNotReproduce: FormCounts; rows: VersionRow[]; highestConfirmedVersion?: string;
};
export type QuestionEntry = EntryBase & { kind: "question"; replyCount: number; resolved?: Resolved; version?: string };
export type ReplyEntry = EntryBase & { kind: "reply"; parentNoteNumber: number; parentGone: boolean };
export type Entry = ProblemEntry | QuestionEntry | ReplyEntry;

export function validateEntry(ecosystem: Ecosystem, value: unknown): Result<Entry, string>; // service self-check before publishing
export function readEntry(value: unknown): ReadResult<Entry>;
export type PageEntry = Exclude<ReadResult<Entry>, { status: "unparseable" }>;
export type PageRead =
	| { status: "ok"; entries: PageEntry[]; cleaned: boolean }
	| { status: "unknown-format"; formatVersion: number }
	| { status: "unparseable" };
export function readDigestPage(value: unknown): PageRead;

// fixtures.ts
export const T0 = 1_700_000_000; // the only exported time; tests write T0 + n
export const workedEntry: ProblemEntry; // Appendix A's worked entry, below
export function problemEntry(overrides?: Partial<ProblemEntry>): ProblemEntry; // a minimal valid problem: noteNumber 1, timeWritten T0, summary "placeholder summary", warningTags [], replyCount 0, both forms { total: 0, nonBurstTotal: 0, burst: false }, rows []; nothing else
```

`src/core/fixtures.ts`, the whole file (the worked entry is spec Appendix A's, from agreement round 9):

```ts
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
```

Rules:

- Reading follows Task 6's pattern: `formatVersion` first (missing, not a safe integer, below 1 → `unparseable`; above 1 → `unknown-format` with `noteNumber` when it is a positive safe integer, nothing else looked at); for version 1 any structural fault is `unparseable`; `summary` and `failureSignature` are stripped and cut (`cleaned`); unknown fields and unknown tags are dropped.
- Structural faults for version 1 (each makes the entry `unparseable`): `noteNumber` or `parentNoteNumber` not a positive safe integer; a count or time that is not a non-negative safe integer; `burst` or `parentGone` not a boolean; `rows` not an array; `warningTags` not an array of strings; more than `LIMITS.versionRows` rows; a row or version field failing `isValidVersion`; `summary` or `failureSignature` already `""` in the object; `nonBurstTotal` greater than `total`; a row's non-burst count greater than its total; `lastNonBurstTime` present when `nonBurstTotal` is 0 or absent when it is not. A field that belongs to another kind is an unknown field and is NOT a fault. Unknown fields inside `resolved`, a form's counts or a row are ignored like any other. Cleaning: `summary` and `failureSignature` are passed through `stripForbidden`, line feeds are removed from `summary`, and each is cut to its cap; a `failureSignature` emptied by that is omitted, a `summary` emptied by that stays `""`.
- `readDigestPage`: the page is `{ formatVersion, entries }`. Same `formatVersion` handling. `entries` not an array, or longer than `LIMITS.entriesPerDigestPage`, → `unparseable`. Any unparseable entry (whatever its `formatVersion` field holds) makes the whole page `unparseable` (the page is one verified object, 11.4 rule 5). `cleaned` is true when any entry was cleaned.
- `validateEntry` is strict: everything `readEntry` calls a fault, plus: an unknown field at any level (the entry, `resolved`, a form's counts, a row), an unknown tag, an empty `summary`, a line feed in `summary`, non-conforming or over-cap text, a row `version` that is not already `rowKey(ecosystem, version)`, two rows with one key, `highestConfirmedVersion` present where `canOrder` is false for it or not already its row key. Its error is a short code naming the first fault (the codes are this file's own; tests check `ok` only).

- [ ] **Step 1: Write `fixtures.ts` and the failing tests** in `src/core/entry.test.ts`

```ts
import { expect, test } from "bun:test";
import { readDigestPage, readEntry, validateEntry } from "./entry.ts";
import { problemEntry, T0, workedEntry } from "./fixtures.ts";

const questionEntry = {
	formatVersion: 1,
	noteNumber: 7,
	kind: "question",
	timeWritten: T0,
	summary: "how to pin?",
	warningTags: [],
	replyCount: 0,
};
const replyEntry = {
	formatVersion: 1,
	noteNumber: 8,
	kind: "reply",
	timeWritten: T0,
	summary: "use --exact",
	warningTags: [],
	parentNoteNumber: 7,
	parentGone: false,
};

test("the worked entry and one of each kind are valid and read back unchanged", () => {
	for (const e of [workedEntry, problemEntry(), questionEntry, replyEntry]) {
		expect<unknown>(validateEntry("npm", e)).toEqual({ ok: true, value: e });
		expect<unknown>(readEntry(e)).toEqual({
			status: "ok",
			value: e,
			cleaned: false,
		});
	}
});
test("structural faults are unparseable", () => {
	const faults: unknown[] = [
		null,
		{},
		{ ...workedEntry, formatVersion: 0 },
		{ ...workedEntry, noteNumber: 0 },
		{ ...workedEntry, noteNumber: 1e30 },
		{ ...workedEntry, timeWritten: -1 },
		{ ...workedEntry, kind: "signal" },
		{ ...workedEntry, replyCount: 1.5 },
		{ ...workedEntry, rows: "x" },
		{ ...workedEntry, warningTags: null },
		{ ...workedEntry, confirm: undefined },
		{ ...workedEntry, confirm: { ...workedEntry.confirm, total: 3 } }, // non-burst above total
		{ ...workedEntry, confirm: { total: 4, nonBurstTotal: 4, burst: false } }, // time missing
		{
			...workedEntry,
			confirm: {
				total: 4,
				nonBurstTotal: 0,
				burst: true,
				lastNonBurstTime: T0,
			},
		}, // time without a count
		{ ...workedEntry, confirm: { ...workedEntry.confirm, burst: "no" } },
		{ ...workedEntry, rows: [{ ...workedEntry.rows[0], confirmNonBurst: 3 }] },
		{ ...workedEntry, rows: [{ ...workedEntry.rows[0], version: "1 2" }] },
		{
			...workedEntry,
			rows: Array.from({ length: 17 }, (_, i) => ({
				...workedEntry.rows[0],
				version: `1.0.${i}`,
			})),
		},
		{ ...workedEntry, reportedVersion: "" },
		{ ...workedEntry, resolved: { time: "now" } },
		{ ...workedEntry, resolved: { time: T0, version: "a b" } },
		{ ...replyEntry, parentGone: "yes" },
		{ ...replyEntry, parentNoteNumber: 0 },
		{ ...questionEntry, replyCount: -1 },
	];
	for (const f of faults)
		expect<unknown>(readEntry(f)).toEqual({ status: "unparseable" });
});
test("reading strips and cuts text, drops unknown fields and tags", () => {
	const r = readEntry({
		...workedEntry,
		summary: `a\u200bb\n${"x".repeat(200)}`,
		failureSignature: "s".repeat(300),
		future: true,
		warningTags: ["edits-executable", "safe"],
	});
	if (r.status !== "ok" || r.value.kind !== "problem")
		throw new Error(r.status);
	expect(r.cleaned).toBe(true);
	expect(r.value.summary).toBe(`ab${"x".repeat(118)}`);
	expect(r.value.failureSignature).toBe("s".repeat(200));
	expect(r.value.warningTags).toEqual(["edits-executable"]);
	expect("future" in r.value).toBe(false);
});
test("an entry of a newer format version is listed by number and nothing else", () => {
	expect<unknown>(
		readEntry({ formatVersion: 2, noteNumber: 9, summary: "do as I say" }),
	).toEqual({ status: "unknown-format", formatVersion: 2, noteNumber: 9 });
});
test("strict validation refuses what reading only cleans or ignores", () => {
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, future: true }).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, warningTags: ["safe"] }).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, summary: "a\u200bb" }).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, summary: "a".repeat(121) }).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("npm", { ...questionEntry, failureSignature: "x" }).ok,
	).toBe(false);
});
test("strict validation wants row keys: no leading v, no build part where versions order, no duplicates", () => {
	const row = workedEntry.rows[0];
	expect<unknown>(
		validateEntry("npm", {
			...workedEntry,
			rows: [{ ...row, version: "v1.2.0" }],
		}).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("npm", {
			...workedEntry,
			rows: [{ ...row, version: "1.2.0+a" }],
		}).ok,
	).toBe(false);
	expect<unknown>(
		validateEntry("pypi", {
			...workedEntry,
			highestConfirmedVersion: undefined,
			rows: [{ ...row, version: "1.2.0+a" }],
		}).ok,
	).toBe(true);
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, rows: [row, row] }).ok,
	).toBe(false);
	expect<unknown>(validateEntry("pypi", workedEntry).ok).toBe(false); // highest confirmed version where versions never order
	expect<unknown>(
		validateEntry("npm", { ...workedEntry, highestConfirmedVersion: "1.2" }).ok,
	).toBe(false);
});
test("reading: empty strings, tags that are not strings, numbers that are not safe, fields of another kind", () => {
	for (const f of [
		{ ...workedEntry, summary: "" },
		{ ...workedEntry, failureSignature: "" },
		{ ...workedEntry, warningTags: [123] },
		{ ...workedEntry, replyCount: 1e30 },
		{ ...workedEntry, formatVersion: 1e30 },
		{
			...workedEntry,
			confirm: { ...workedEntry.confirm, lastNonBurstTime: 1e30 },
		},
	])
		expect<unknown>(readEntry(f)).toEqual({ status: "unparseable" });
	expect<unknown>(
		readEntry({ ...questionEntry, rows: "x", parentGone: "yes" }),
	).toEqual({ status: "ok", value: questionEntry, cleaned: false });
	const emptied = readEntry({
		...workedEntry,
		summary: "\u200b",
		failureSignature: "\u200b",
	});
	if (emptied.status !== "ok") throw new Error(emptied.status);
	expect(emptied.cleaned).toBe(true);
	expect<unknown>(emptied.value).toEqual({ ...workedEntry, summary: "" });
	const nested = readEntry({
		...workedEntry,
		resolved: { time: T0, future: 1 },
		rows: workedEntry.rows.map((r) => ({ ...r, future: 1 })),
	});
	expect<unknown>(nested).toEqual({
		status: "ok",
		value: { ...workedEntry, resolved: { time: T0 } },
		cleaned: false,
	});
});
test("strict validation covers what reading calls a fault, and more", () => {
	const row = workedEntry.rows[0];
	for (const f of [
		{ ...workedEntry, summary: "" },
		{ ...workedEntry, summary: "two\u000alines" },
		{ ...workedEntry, failureSignature: "" },
		{ ...workedEntry, replyCount: -1 },
		{ ...workedEntry, confirm: { ...workedEntry.confirm, total: 3 } },
		{ ...workedEntry, confirm: { ...workedEntry.confirm, burst: 1 } },
		{ ...workedEntry, confirm: { ...workedEntry.confirm, future: 1 } },
		{ ...workedEntry, resolved: { time: T0, future: 1 } },
		{ ...workedEntry, rows: [{ ...row, future: 1 }] },
		{ ...workedEntry, highestConfirmedVersion: "v1.2.1" },
		{ ...workedEntry, highestConfirmedVersion: "1.2.1+x" },
		{
			...workedEntry,
			rows: Array.from({ length: 17 }, (_, i) => ({
				...row,
				version: `1.0.${i}`,
			})),
		},
	])
		expect(validateEntry("npm", f).ok).toBe(false);
	const sixteen = {
		...workedEntry,
		rows: Array.from({ length: 16 }, (_, i) => ({
			...row,
			version: `1.0.${i}`,
		})),
	};
	expect(validateEntry("npm", sixteen).ok).toBe(true);
	expect(readEntry(sixteen).status).toBe("ok");
});
test("a page is cleaned when one entry was, and any broken entry breaks it", () => {
	const cleaned = readDigestPage({
		formatVersion: 1,
		entries: [{ ...questionEntry, summary: "a\u200bb" }],
	});
	if (cleaned.status !== "ok") throw new Error(cleaned.status);
	expect(cleaned.cleaned).toBe(true);
	for (const broken of [
		null,
		7,
		{},
		{ formatVersion: "1" },
		{ formatVersion: 0, noteNumber: 3 },
	])
		expect<unknown>(
			readDigestPage({ formatVersion: 1, entries: [questionEntry, broken] }),
		).toEqual({ status: "unparseable" });
});
test("a digest page", () => {
	const page = {
		formatVersion: 1,
		entries: [workedEntry, questionEntry, { formatVersion: 2, noteNumber: 9 }],
	};
	const r = readDigestPage(page);
	if (r.status !== "ok") throw new Error(r.status);
	expect(r.cleaned).toBe(false);
	expect(r.entries.map((e) => e.status)).toEqual([
		"ok",
		"ok",
		"unknown-format",
	]);
	expect<unknown>(readDigestPage({ formatVersion: 2, entries: "?" })).toEqual({
		status: "unknown-format",
		formatVersion: 2,
	});
	expect<unknown>(
		readDigestPage({
			formatVersion: 1,
			entries: [workedEntry, { formatVersion: 1 }],
		}),
	).toEqual({ status: "unparseable" });
	expect<unknown>(readDigestPage({ formatVersion: 1 })).toEqual({
		status: "unparseable",
	});
	expect<unknown>(
		readDigestPage({
			formatVersion: 1,
			entries: Array.from({ length: 51 }, () => questionEntry),
		}),
	).toEqual({ status: "unparseable" });
	expect<unknown>(
		readDigestPage({
			formatVersion: 1,
			entries: Array.from({ length: 50 }, () => questionEntry),
		}).status,
	).toBe("ok");
});
```

- [ ] **Step 2: Run to see them fail** — `bun test src/core/entry.test.ts`, expected FAIL, module not found.

- [ ] **Step 3: Implement `entry.ts`** to the rules above, reusing Task 6's helpers.

- [ ] **Step 4: Run tests and gates** — `bun test src/core && just fmt && just typecheck && just lint`, expected all pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src/core && git commit -m "Add the digest entry and page formats to the mailbox core"
```

---

### Task 8: Status data from current counted votes (12.2 last rule, 12.3)

**Files:**

- Create: `src/core/status.ts`
- Test: `src/core/status.test.ts`

**Interfaces:**

- Consumes: `FormCounts`, `VersionRow`, `rowKey`, `canOrder`, `compareVersions`, `Ecosystem`, `LIMITS.versionRows`.
- Produces:

```ts
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
export function deriveStatus(
	ecosystem: Ecosystem,
	votes: readonly Vote[],
	maxRows?: number,
): StatusCounts; // maxRows defaults to LIMITS.versionRows
```

The votes given are the current counted votes of one note; who may vote and how a signal changes that set is the service plan's. Rules:

- Per form: `total` is the number of votes; `nonBurstTotal` leaves out `isBurst` votes; `burst` is true when any vote of the form is a burst arrival; `lastNonBurstTime` is the latest `arrivalTime` among non-burst votes, absent when there is none.
- Rows: one per `rowKey(ecosystem, version)` among votes that carry a version; a vote with no version is in the totals and in no row. Kept rows are returned sorted: rows that can be ordered first, ascending by version, then the others ascending by byte order of the key.
- When there are more rows than `maxRows`, whole rows are dropped until `maxRows` remain: first rows whose version cannot be ordered, least recent first by the latest `arrivalTime` among their votes (burst or not), ties by the key lower in byte order first (compare UTF-8 bytes; keys are ASCII, so plain `<` on the strings is the same); then rows that can be ordered, oldest version first. Totals are not changed by dropping.
- `highestConfirmedVersion`: the highest row key, by `compareVersions`, among non-burst confirm votes whose version `canOrder`; computed from all votes, before dropping; absent when there is none or the ecosystem does not order versions.
- The result depends only on the set of votes, not on their order in the array.
- `maxRows` must be a positive integer; anything else throws a `RangeError`.

- [ ] **Step 1: Write the failing tests** in `src/core/status.test.ts`

```ts
import { expect, test } from "bun:test";
import { T0, workedEntry } from "./fixtures.ts";
import { deriveStatus, type Vote } from "./status.ts";

const c = (version: string | undefined, t: number, isBurst = false): Vote => ({
	form: "confirm",
	version,
	arrivalTime: T0 + t,
	isBurst,
});
const d = (version: string | undefined, t: number, isBurst = false): Vote => ({
	form: "doesNotReproduce",
	version,
	arrivalTime: T0 + t,
	isBurst,
});

const workedVotes = [
	c("1.2.0", 100),
	c("v1.2.0", 200),
	c("1.2.1", 300),
	c("1.2.1+build", 500),
	d("1.3.0", 400),
	d("1.3.0", 450),
	d("v1.3.0", 600),
];

test("the worked entry's status data comes out of its votes, in any order", () => {
	const want = {
		confirm: workedEntry.confirm,
		doesNotReproduce: workedEntry.doesNotReproduce,
		rows: workedEntry.rows,
		highestConfirmedVersion: "1.2.1",
	};
	expect(deriveStatus("npm", workedVotes)).toEqual(want);
	expect(deriveStatus("npm", [...workedVotes].reverse())).toEqual(want);
});
test("no votes", () => {
	expect(deriveStatus("npm", [])).toEqual({
		confirm: { total: 0, nonBurstTotal: 0, burst: false },
		doesNotReproduce: { total: 0, nonBurstTotal: 0, burst: false },
		rows: [],
	});
});
test("a vote without a version counts in the totals and in no row", () => {
	const s = deriveStatus("npm", [c(undefined, 100), c("1.0.0", 50)]);
	expect(s.confirm).toEqual({
		total: 2,
		nonBurstTotal: 2,
		burst: false,
		lastNonBurstTime: T0 + 100,
	});
	expect(s.rows.map((r) => r.version)).toEqual(["1.0.0"]);
});
test("burst arrivals are in the totals only; they move neither the last time nor the highest confirmed version", () => {
	const s = deriveStatus("npm", [
		c("1.0.0", 100),
		c("9.0.0", 900, true),
		c("9.0.0", 901, true),
	]);
	expect(s.confirm).toEqual({
		total: 3,
		nonBurstTotal: 1,
		burst: true,
		lastNonBurstTime: T0 + 100,
	});
	expect(s.highestConfirmedVersion).toBe("1.0.0");
	expect(s.rows).toEqual([
		{
			version: "1.0.0",
			confirmTotal: 1,
			confirmNonBurst: 1,
			doesNotReproduceTotal: 0,
			doesNotReproduceNonBurst: 0,
		},
		{
			version: "9.0.0",
			confirmTotal: 2,
			confirmNonBurst: 0,
			doesNotReproduceTotal: 0,
			doesNotReproduceNonBurst: 0,
		},
	]);
	expect(deriveStatus("npm", [c("1.0.0", 1, true)]).confirm).toEqual({
		total: 1,
		nonBurstTotal: 0,
		burst: true,
	});
});
test("where versions never order there is no highest confirmed version and rows keep the build part", () => {
	const s = deriveStatus("pypi", [c("1.0+a", 1), c("v1.0+a", 2), c("1.0", 3)]);
	expect(s.highestConfirmedVersion).toBeUndefined();
	expect(s.rows.map((r) => [r.version, r.confirmTotal])).toEqual([
		["1.0", 1],
		["1.0+a", 2],
	]);
});
test("rows are dropped in the stated order and totals keep their counts", () => {
	// two unorderable rows and three orderable ones
	const votes = [
		c("nightly", 500),
		c("latest", 100),
		c("1.0.0", 900),
		c("2.0.0", 10),
		c("3.0.0", 20),
	];
	expect(deriveStatus("npm", votes, 4).rows.map((r) => r.version)).toEqual([
		"1.0.0",
		"2.0.0",
		"3.0.0",
		"nightly",
	]); // "latest" is least recent
	expect(deriveStatus("npm", votes, 3).rows.map((r) => r.version)).toEqual([
		"1.0.0",
		"2.0.0",
		"3.0.0",
	]);
	expect(deriveStatus("npm", votes, 2).rows.map((r) => r.version)).toEqual([
		"2.0.0",
		"3.0.0",
	]); // oldest version first, whatever its time
	expect(deriveStatus("npm", votes, 2).confirm.total).toBe(5);
	expect(deriveStatus("npm", votes, 2).highestConfirmedVersion).toBe("3.0.0");
});
test("the row bound must be a positive integer", () => {
	for (const n of [0, -1, 1.5, Number.NaN])
		expect(() => deriveStatus("npm", [], n)).toThrow(RangeError);
});
test("a dropped row's version can still be the highest confirmed version", () => {
	const votes = [c("5.0.0", 1), d("6.0.0", 2), d("7.0.0", 3)];
	const s = deriveStatus("npm", votes, 2);
	expect(s.rows.map((r) => r.version)).toEqual(["6.0.0", "7.0.0"]);
	expect(s.highestConfirmedVersion).toBe("5.0.0");
});
test("unorderable rows that tie on time drop the lower key first", () => {
	const votes = [c("beta", 100), c("alpha", 100), c("gamma", 100)];
	expect(deriveStatus("npm", votes, 2).rows.map((r) => r.version)).toEqual([
		"beta",
		"gamma",
	]);
	expect(deriveStatus("tool", votes, 1).rows.map((r) => r.version)).toEqual([
		"gamma",
	]);
});
test("how recent an unorderable row is counts burst votes too", () => {
	const votes = [c("aaa", 10), c("aaa", 900, true), c("bbb", 500)];
	expect(deriveStatus("tool", votes, 1).rows.map((r) => r.version)).toEqual([
		"aaa",
	]);
});
test("the default bound is sixteen rows", () => {
	const votes = Array.from({ length: 20 }, (_, i) => c(`1.0.${i}`, i));
	const s = deriveStatus("npm", votes);
	expect(s.rows.length).toBe(16);
	expect(s.rows[0]?.version).toBe("1.0.4");
});
```

- [ ] **Step 2: Run to see them fail** — `bun test src/core/status.test.ts`, expected FAIL, module not found.

- [ ] **Step 3: Implement `status.ts`** to the rules above.

- [ ] **Step 4: Run tests and gates** — `bun test src/core && just fmt && just typecheck && just lint`, expected all pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src/core && git commit -m "Derive a note's status data from its current counted votes"
```

---

### Task 9: The five marks (12.4)

**Files:**

- Create: `src/core/mark.ts`
- Test: `src/core/mark.test.ts`

**Interfaces:**

- Consumes: `Entry`, `Ecosystem`, `ordersVersions`, `canOrder`, `compareVersions`, `versionsEqual`, `LIMITS.notReproducedThreshold`, the fixtures.
- Produces:

```ts
export type Mark =
	| "resolved"
	| "not-reproduced-on-newer"
	| "disputed-on-your-version"
	| "same-version"
	| "unknown";
export function markEntry(
	ecosystem: Ecosystem,
	entry: Entry,
	installed: string | undefined,
	threshold?: number,
): Mark; // threshold defaults to LIMITS.notReproducedThreshold
```

`installed` is the value `resolveInstalled` produced: a version that passed 12.1, or `undefined`. The function reads only the entry. Exactly one mark, the first whose condition holds:

1. `resolved` (problems and questions): `entry.resolved` is present; and the entry has no `confirm.lastNonBurstTime` (always so for a question) or it is not later than `resolved.time`; and either `resolved.version` is absent, or `installed` is known and `versionsEqual` to it, or both `canOrder` and `installed` is not older than it. With a versioned mark and no installed version, the condition fails.
2. `not-reproduced-on-newer` (problems only, `ordersVersions(ecosystem)` only, `installed` must `canOrder`): the highest affected version is the highest of `reportedVersion`, `authorObservedVersion` and `highestConfirmedVersion` among those present for which `canOrder` is true; with none, the mark does not apply. It holds when `installed` is newer than that and the sum of `doesNotReproduceNonBurst` over rows whose version `canOrder`, is newer than the highest affected version and is not newer than `installed`, is at least `threshold`.
3. `disputed-on-your-version` (problems only): `installed` is known, a row's version `versionsEqual` it, and in that row `doesNotReproduceNonBurst > confirmNonBurst`.
4. `same-version`: `installed` is known and `versionsEqual` to `reportedVersion` (a question's `version`), or to `authorObservedVersion`, or to the version of a row whose `confirmNonBurst` is not zero.
5. `unknown`: otherwise. A reply is always `unknown`.

- [ ] **Step 1: Write the failing tests** in `src/core/mark.test.ts`

```ts
import { expect, test } from "bun:test";
import type { Entry } from "./entry.ts";
import { problemEntry, T0, workedEntry } from "./fixtures.ts";
import { markEntry } from "./mark.ts";

test("the worked entry, for every installed version both agents computed", () => {
	expect(markEntry("npm", workedEntry, undefined)).toBe("unknown");
	expect(markEntry("npm", workedEntry, "1.1.0")).toBe("unknown");
	expect(markEntry("npm", workedEntry, "1.2.0")).toBe("same-version");
	expect(markEntry("npm", workedEntry, "1.2.1")).toBe("same-version");
	expect(markEntry("npm", workedEntry, "1.3.0")).toBe(
		"not-reproduced-on-newer",
	);
	expect(markEntry("npm", workedEntry, "1.4.0")).toBe(
		"not-reproduced-on-newer",
	);
	expect(markEntry("npm", workedEntry, "v1.3.0+local")).toBe(
		"not-reproduced-on-newer",
	);
});
test("mark 2 needs the threshold, counts non-burst votes only, and never applies where versions do not order", () => {
	expect(markEntry("npm", workedEntry, "1.3.0", 4)).toBe(
		"disputed-on-your-version",
	); // row 1.3.0: 3 against 0
	expect(markEntry("npm", workedEntry, "1.4.0", 4)).toBe("unknown");
	const burst = {
		...workedEntry,
		rows: workedEntry.rows.map((r) =>
			r.version === "1.3.0" ? { ...r, doesNotReproduceNonBurst: 2 } : r,
		),
	};
	expect(markEntry("npm", burst, "1.4.0")).toBe("unknown");
	expect(
		markEntry(
			"pypi",
			{ ...workedEntry, highestConfirmedVersion: undefined },
			"1.4.0",
		),
	).toBe("unknown");
	expect(
		markEntry(
			"pypi",
			{ ...workedEntry, highestConfirmedVersion: undefined },
			"1.3.0",
		),
	).toBe("disputed-on-your-version");
});
test("mark 2 uses the highest affected version and ignores one that does not match the grammar", () => {
	const observed = { ...workedEntry, authorObservedVersion: "1.3.0" };
	expect(markEntry("npm", observed, "1.4.0")).toBe("unknown"); // nothing is newer than 1.3.0 and not newer than 1.4.0
	expect(markEntry("npm", observed, "1.3.0")).toBe("disputed-on-your-version"); // mark 2 fails (not newer); row 1.3.0 is 3 against 0
	const odd = {
		...workedEntry,
		reportedVersion: "latest",
		highestConfirmedVersion: undefined,
	};
	expect(markEntry("npm", odd, "1.4.0")).toBe("unknown"); // no affected version known
});
test("a dropped row contributes to no mark", () => {
	const dropped = {
		...workedEntry,
		rows: workedEntry.rows.filter((r) => r.version !== "1.3.0"),
	};
	expect(markEntry("npm", dropped, "1.4.0")).toBe("unknown");
	const droppedConfirm = {
		...workedEntry,
		rows: workedEntry.rows.filter((r) => r.version !== "1.2.1"),
	};
	expect(markEntry("npm", droppedConfirm, "1.2.1")).toBe("unknown"); // highest confirmed version alone is not mark 4
});
test("mark 3: disputed on your version outranks same version", () => {
	const e = problemEntry({
		reportedVersion: "2.0.0",
		rows: [
			{
				version: "2.0.0",
				confirmTotal: 1,
				confirmNonBurst: 1,
				doesNotReproduceTotal: 2,
				doesNotReproduceNonBurst: 2,
			},
		],
	});
	expect(markEntry("npm", e, "2.0.0")).toBe("disputed-on-your-version");
	expect(markEntry("npm", e, "v2.0.0+x")).toBe("disputed-on-your-version");
	const even = problemEntry({
		reportedVersion: "2.0.0",
		rows: [
			{
				version: "2.0.0",
				confirmTotal: 2,
				confirmNonBurst: 2,
				doesNotReproduceTotal: 2,
				doesNotReproduceNonBurst: 2,
			},
		],
	});
	expect(markEntry("npm", even, "2.0.0")).toBe("same-version");
});
test("mark 4: reported, author-observed, or a row with a non-burst confirmation", () => {
	expect(
		markEntry("tool", problemEntry({ reportedVersion: "2024-01" }), "2024-01"),
	).toBe("same-version");
	expect(
		markEntry("tool", problemEntry({ reportedVersion: "2024-01" }), "v2024-01"),
	).toBe("same-version");
	expect(
		markEntry("npm", problemEntry({ authorObservedVersion: "3.1.0" }), "3.1.0"),
	).toBe("same-version");
	const burstOnly = problemEntry({
		rows: [
			{
				version: "4.0.0",
				confirmTotal: 5,
				confirmNonBurst: 0,
				doesNotReproduceTotal: 0,
				doesNotReproduceNonBurst: 0,
			},
		],
	});
	expect(markEntry("npm", burstOnly, "4.0.0")).toBe("unknown");
	expect(
		markEntry("npm", problemEntry({ reportedVersion: "1.2" }), "1.2.0"),
	).toBe("unknown"); // not orderable: whole-string equality
});
test("mark 1: resolved", () => {
	const resolved = (extra: object) =>
		problemEntry({
			reportedVersion: "1.0.0",
			resolved: { time: T0 + 1000 },
			...extra,
		});
	expect(markEntry("npm", resolved({}), undefined)).toBe("resolved");
	expect(markEntry("npm", resolved({}), "1.0.0")).toBe("resolved");
	const confirmedBefore = {
		confirm: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0 + 1000,
		},
	};
	expect(markEntry("npm", resolved(confirmedBefore), "1.0.0")).toBe("resolved"); // not later than the mark
	const confirmedAfter = {
		confirm: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0 + 1001,
		},
	};
	expect(markEntry("npm", resolved(confirmedAfter), "1.0.0")).toBe(
		"same-version",
	); // a later confirmation removes it
	const burstAfter = { confirm: { total: 6, nonBurstTotal: 0, burst: true } };
	expect(markEntry("npm", resolved(burstAfter), "1.0.0")).toBe("resolved"); // a burst does not cancel it
});
test("mark 1 with a version", () => {
	const from = problemEntry({
		reportedVersion: "1.0.0",
		resolved: { time: T0 + 1000, version: "1.5.0" },
	});
	expect(markEntry("npm", from, "1.5.0")).toBe("resolved");
	expect(markEntry("npm", from, "2.0.0")).toBe("resolved");
	expect(markEntry("npm", from, "1.4.9")).toBe("unknown");
	expect(markEntry("npm", from, "1.0.0")).toBe("same-version");
	expect(markEntry("npm", from, undefined)).toBe("unknown");
	const tool = problemEntry({
		resolved: { time: T0 + 1000, version: "2024-02" },
	});
	expect(markEntry("tool", tool, "2024-02")).toBe("resolved");
	expect(markEntry("tool", tool, "2024-03")).toBe("unknown"); // equality only
});
test("mark 2: the upper bound, the highest confirmed version, and what it ignores", () => {
	expect(markEntry("npm", workedEntry, "1.2.5")).toBe("unknown"); // row 1.3.0 is newer than the installed version
	const confirmedHigher = problemEntry({
		reportedVersion: "1.0.0",
		highestConfirmedVersion: "2.0.0",
		rows: [
			{
				version: "1.5.0",
				confirmTotal: 0,
				confirmNonBurst: 0,
				doesNotReproduceTotal: 3,
				doesNotReproduceNonBurst: 3,
			},
		],
	});
	expect(markEntry("npm", confirmedHigher, "2.5.0")).toBe("unknown"); // 1.5.0 is not newer than 2.0.0
	expect(
		markEntry(
			"npm",
			{ ...confirmedHigher, highestConfirmedVersion: undefined },
			"2.5.0",
		),
	).toBe("not-reproduced-on-newer");
	const oddReported = { ...workedEntry, reportedVersion: "latest" };
	expect(markEntry("npm", oddReported, "1.3.0")).toBe(
		"not-reproduced-on-newer",
	); // 1.2.1 still counts
	const oddRow = problemEntry({
		reportedVersion: "1.0.0",
		rows: [
			{
				version: "nightly",
				confirmTotal: 0,
				confirmNonBurst: 0,
				doesNotReproduceTotal: 5,
				doesNotReproduceNonBurst: 5,
			},
		],
	});
	expect(markEntry("npm", oddRow, "2.0.0")).toBe("unknown"); // a row that cannot be ordered is in no sum
	expect(markEntry("npm", workedEntry, "latest")).toBe("unknown"); // an installed version that cannot be ordered
});
test("mark 1 outranks marks 2 and 3", () => {
	const resolved = { ...workedEntry, resolved: { time: T0 + 1000 } };
	expect(markEntry("npm", resolved, "1.4.0")).toBe("resolved");
	expect(markEntry("npm", resolved, "1.3.0", 4)).toBe("resolved");
});
test("questions and replies", () => {
	const q: Entry = {
		formatVersion: 1,
		noteNumber: 7,
		kind: "question",
		timeWritten: T0,
		summary: "q",
		warningTags: [],
		replyCount: 0,
		version: "1.0.0",
	};
	expect(markEntry("npm", q, "1.0.0")).toBe("same-version");
	expect(markEntry("npm", q, "2.0.0")).toBe("unknown");
	expect(markEntry("npm", { ...q, resolved: { time: T0 } }, undefined)).toBe(
		"resolved",
	);
	const r: Entry = {
		formatVersion: 1,
		noteNumber: 8,
		kind: "reply",
		timeWritten: T0,
		summary: "r",
		warningTags: [],
		parentNoteNumber: 7,
		parentGone: true,
	};
	expect(markEntry("npm", r, "1.0.0")).toBe("unknown");
});
```

- [ ] **Step 2: Run to see them fail** — `bun test src/core/mark.test.ts`, expected FAIL, module not found.

- [ ] **Step 3: Implement `mark.ts`** as five private predicates tried in order.

- [ ] **Step 4: Run tests and gates** — `bun test src/core && just fmt && just typecheck && just lint`, expected all pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src/core && git commit -m "Add the applies-to-you marks to the mailbox core"
```

---

### Task 10: Order and what a lookup lists (12.5, 6.1 rule 6, 7.1, 7.2, 9.6 rule 6)

**Files:**

- Create: `src/core/order.ts`, `src/core/lookup.ts`
- Test: `src/core/order.test.ts`, `src/core/lookup.test.ts`

**Interfaces:**

- Consumes: `Entry`, `ReplyEntry`, `PageEntry`, `Mark`, `markEntry`, `queryWords`, `countMatches`, `Ecosystem`, `LIMITS`, the fixtures.
- Produces:

```ts
// order.ts
export type OrderKeys = { words: number; markRank: number; balance: number; time: number; noteNumber: number };
export const MARK_RANK: Record<Mark, number>; // same-version 0, unknown 1, disputed-on-your-version 2, not-reproduced-on-newer 3, resolved 4
export function orderKeys(ecosystem: Ecosystem, entry: Entry, installed: string | undefined, words: readonly string[]): OrderKeys;
export function compareEntries(a: OrderKeys, b: OrderKeys): number; // negative when a is listed first
export function sortEntries(ecosystem: Ecosystem, entries: readonly Entry[], installed: string | undefined, query: string): Entry[];

// lookup.ts
export type LookupKind = "problem" | "question" | "reply";
export type LookupGroup = {
	shown: { entry: Entry; mark: Mark }[]; // at most LIMITS.summariesPerGroup
	notShown: number; // entries of the kinds asked for that come after this group
	unknownFormat: { count: number; noteNumbers: number[] }; // numbers: at most LIMITS.unknownFormatListed, ascending
};
export function lookupGroup(
	ecosystem: Ecosystem,
	entries: readonly PageEntry[], // the entries of the pages a lookup read (PageEntry is Task 7's: never "unparseable")
	options: { kinds?: readonly LookupKind[]; installed?: string; query?: string; group?: number }, // group 0 is the first
): LookupGroup;
export function listReplies(entries: readonly Entry[], parentNoteNumber: number, group?: number): { shown: ReplyEntry[]; notShown: number };
```

Rules:

- Keys, in turn: `words` (more first) is `countMatches(words, text)` where the text is the summary and, for a problem that has one, the failure signature, joined by a line feed; 0 when there are no words. `markRank` (lower first). `balance` (higher first) is `confirm.nonBurstTotal - doesNotReproduce.nonBurstTotal` for a problem and 0 otherwise. `time` (later first) is `confirm.lastNonBurstTime` when present, otherwise `timeWritten`. `noteNumber` (higher first).
- `sortEntries` computes `queryWords(query)` once. Words rank and never filter.
- `lookupGroup`: entries with status `unknown-format` are counted and reported apart, the same in every group: `count` is all of them; `noteNumbers` is the numbers of those that carry one, sorted ascending, then the lowest `LIMITS.unknownFormatListed` kept. They get no mark, are outside the order and do not count toward the group size. Of the rest, a lookup lists problems, questions, and replies whose `parentGone` is true; a reply to a published note is never listed. `kinds` filters among those three (default all three; `"reply"` means the orphan replies). The listed entries are sorted, then cut into groups of `LIMITS.summariesPerGroup`; `notShown` counts the entries after the group returned. No entry is left out because of its mark. `kinds` does not change the unknown-format report. `group` must be a non-negative integer; anything else throws a `RangeError`.
- `listReplies`: the replies whose `parentNoteNumber` matches, oldest first by `noteNumber`, in groups of `LIMITS.repliesPerGroup`. Its `group` follows the same rule as `lookupGroup`'s: a non-negative integer, anything else throws a `RangeError`.

- [ ] **Step 1: Write the failing tests** in `src/core/order.test.ts` and `src/core/lookup.test.ts`

```ts
// order.test.ts
import { expect, test } from "bun:test";
import { problemEntry, T0, workedEntry } from "./fixtures.ts";
import { compareEntries, MARK_RANK, orderKeys, sortEntries } from "./order.ts";

const numbers = (entries: { noteNumber: number }[]) =>
	entries.map((e) => e.noteNumber);

test("the worked entry's keys with one matching word and 1.2.1 installed", () => {
	expect(orderKeys("npm", workedEntry, "1.2.1", ["lock"])).toEqual({
		words: 1,
		markRank: MARK_RANK["same-version"],
		balance: 1,
		time: T0 + 500,
		noteNumber: 41,
	});
});
test("the mark order is same, unknown, disputed, not reproduced, resolved", () => {
	expect(MARK_RANK).toEqual({
		"same-version": 0,
		unknown: 1,
		"disputed-on-your-version": 2,
		"not-reproduced-on-newer": 3,
		resolved: 4,
	});
});
test("key 1 alone: more distinct words first; no match is listed last, not dropped", () => {
	const a = problemEntry({ noteNumber: 1, summary: "lock file is stale" });
	const b = problemEntry({ noteNumber: 2, summary: "lock is held" });
	const c = problemEntry({ noteNumber: 3, summary: "nothing relevant" });
	expect(
		numbers(sortEntries("npm", [c, b, a], undefined, "lock file")),
	).toEqual([1, 2, 3]);
});
test("key 1 reads the failure signature and matches whole folded words", () => {
	const sig = problemEntry({
		noteNumber: 1,
		summary: "install fails",
		failureSignature: "E_LOCK busy",
	});
	const part = problemEntry({ noteNumber: 2, summary: "lockfile fails" });
	expect(numbers(sortEntries("npm", [part, sig], undefined, "LOCK"))).toEqual([
		1, 2,
	]);
});
test("key 2 alone: a disputed note ranks below a same-version one and below an unknown one", () => {
	const same = problemEntry({ noteNumber: 1, reportedVersion: "2.0.0" });
	const unknown = problemEntry({ noteNumber: 2, reportedVersion: "1.0.0" });
	const disputed = problemEntry({
		noteNumber: 3,
		rows: [
			{
				version: "2.0.0",
				confirmTotal: 0,
				confirmNonBurst: 0,
				doesNotReproduceTotal: 1,
				doesNotReproduceNonBurst: 1,
			},
		],
		doesNotReproduce: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0,
		},
	});
	const resolved = problemEntry({ noteNumber: 4, resolved: { time: T0 + 10 } });
	expect(
		numbers(
			sortEntries("npm", [resolved, disputed, unknown, same], "2.0.0", ""),
		),
	).toEqual([1, 2, 3, 4]);
});
test("key 3 alone: the non-burst balance, higher first", () => {
	const two = problemEntry({
		noteNumber: 2,
		confirm: { total: 9, nonBurstTotal: 2, burst: true, lastNonBurstTime: T0 },
	});
	const three = problemEntry({
		noteNumber: 1,
		confirm: { total: 3, nonBurstTotal: 3, burst: false, lastNonBurstTime: T0 },
	});
	expect(numbers(sortEntries("npm", [two, three], undefined, ""))).toEqual([
		1, 2,
	]); // key 5 alone would say 2, 1
});
test("key 4 alone: the last non-burst confirmation, or the time written, later first", () => {
	const confirmedLate = problemEntry({
		noteNumber: 1,
		timeWritten: T0,
		confirm: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0 + 900,
		},
		doesNotReproduce: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0,
		},
	});
	const writtenLater = problemEntry({ noteNumber: 2, timeWritten: T0 + 500 });
	expect(
		numbers(sortEntries("npm", [writtenLater, confirmedLate], undefined, "")),
	).toEqual([1, 2]);
});
test("key 5 alone: the higher number first", () => {
	expect(
		numbers(
			sortEntries(
				"npm",
				[problemEntry({ noteNumber: 5 }), problemEntry({ noteNumber: 6 })],
				undefined,
				"",
			),
		),
	).toEqual([6, 5]);
});
test("each key outranks the next one when they disagree", () => {
	// key 1 over key 2: a matching unknown entry before a same-version one that does not match
	const matches = problemEntry({ noteNumber: 1, summary: "lock is stale" });
	const sameVersion = problemEntry({ noteNumber: 2, reportedVersion: "2.0.0" });
	expect(
		numbers(sortEntries("npm", [sameVersion, matches], "2.0.0", "lock")),
	).toEqual([1, 2]);
	// key 2 over key 3: same version with balance 0 before unknown with balance 5
	const same = problemEntry({ noteNumber: 1, reportedVersion: "2.0.0" });
	const popular = problemEntry({
		noteNumber: 2,
		confirm: {
			total: 5,
			nonBurstTotal: 5,
			burst: false,
			lastNonBurstTime: T0 + 900,
		},
	});
	expect(numbers(sortEntries("npm", [popular, same], "2.0.0", ""))).toEqual([
		1, 2,
	]);
	// key 3 over key 4: balance 2 confirmed long ago before balance 1 confirmed just now
	const older = problemEntry({
		noteNumber: 1,
		confirm: { total: 2, nonBurstTotal: 2, burst: false, lastNonBurstTime: T0 },
	});
	const newer = problemEntry({
		noteNumber: 2,
		confirm: {
			total: 1,
			nonBurstTotal: 1,
			burst: false,
			lastNonBurstTime: T0 + 900,
		},
	});
	expect(numbers(sortEntries("npm", [newer, older], undefined, ""))).toEqual([
		1, 2,
	]);
});
test("the comparison is a total order", () => {
	const k = orderKeys("npm", workedEntry, "1.2.1", []);
	expect(compareEntries(k, k)).toBe(0);
	expect(compareEntries(k, { ...k, noteNumber: 40 })).toBeLessThan(0);
});
```

```ts
// lookup.test.ts
import { expect, test } from "bun:test";
import type { Entry, PageEntry, ReplyEntry } from "./entry.ts";
import { problemEntry, T0 } from "./fixtures.ts";
import { listReplies, lookupGroup } from "./lookup.ts";

const okEntry = (entry: Entry): PageEntry => ({
	status: "ok",
	value: entry,
	cleaned: false,
});
const question = (noteNumber: number): Entry => ({
	formatVersion: 1,
	noteNumber,
	kind: "question",
	timeWritten: T0,
	summary: "q",
	warningTags: [],
	replyCount: 0,
});
const reply = (
	noteNumber: number,
	parentNoteNumber: number,
	parentGone: boolean,
): ReplyEntry => ({
	formatVersion: 1,
	noteNumber,
	kind: "reply",
	timeWritten: T0,
	summary: "r",
	warningTags: [],
	parentNoteNumber,
	parentGone,
});
const shownNumbers = (g: { shown: { entry: Entry }[] }) =>
	g.shown.map((s) => s.entry.noteNumber);

test("a lookup lists problems, questions and replies to a removed note, never a reply to a published one", () => {
	const entries = [
		problemEntry({ noteNumber: 1 }),
		question(2),
		reply(3, 1, false),
		reply(4, 9, true),
	].map(okEntry);
	expect(shownNumbers(lookupGroup("npm", entries, {}))).toEqual([4, 2, 1]);
	expect(
		shownNumbers(lookupGroup("npm", entries, { kinds: ["question"] })),
	).toEqual([2]);
	expect(
		shownNumbers(lookupGroup("npm", entries, { kinds: ["reply"] })),
	).toEqual([4]);
	expect(
		shownNumbers(
			lookupGroup("npm", entries, { kinds: ["problem", "question"] }),
		),
	).toEqual([2, 1]);
});
test("groups of ten, with the rest counted and reachable in the same order", () => {
	const entries = Array.from({ length: 23 }, (_, i) =>
		okEntry(problemEntry({ noteNumber: i + 1 })),
	);
	const first = lookupGroup("npm", entries, {});
	expect(shownNumbers(first)).toEqual([23, 22, 21, 20, 19, 18, 17, 16, 15, 14]);
	expect(first.notShown).toBe(13);
	const third = lookupGroup("npm", entries, { group: 2 });
	expect(shownNumbers(third)).toEqual([3, 2, 1]);
	expect(third.notShown).toBe(0);
	expect(lookupGroup("npm", entries, { group: 3 }).shown).toEqual([]);
});
test("a group number must be a non-negative integer, and kinds do not change the unknown-format report", () => {
	const entries: PageEntry[] = [
		okEntry(question(2)),
		{ status: "unknown-format", formatVersion: 2, noteNumber: 9 },
	];
	for (const group of [-1, 1.5, Number.NaN])
		expect(() => lookupGroup("npm", entries, { group })).toThrow(RangeError);
	const g = lookupGroup("npm", entries, { kinds: ["problem"] });
	expect(g.shown).toEqual([]);
	expect(g.unknownFormat).toEqual({ count: 1, noteNumbers: [9] });
});
test("words rank and do not filter; every shown entry carries its mark", () => {
	const entries = [
		problemEntry({
			noteNumber: 1,
			summary: "lock is stale",
			reportedVersion: "1.0.0",
		}),
		problemEntry({ noteNumber: 2, summary: "other" }),
	].map(okEntry);
	const g = lookupGroup("npm", entries, { query: "lock", installed: "1.0.0" });
	expect(g.shown.map((s) => [s.entry.noteNumber, s.mark])).toEqual([
		[1, "same-version"],
		[2, "unknown"],
	]);
	expect(g.notShown).toBe(0);
});
test("entries of an unknown format are reported apart, outside the order and the cap", () => {
	const unknown = (noteNumber?: number): PageEntry => ({
		status: "unknown-format",
		formatVersion: 2,
		...(noteNumber === undefined ? {} : { noteNumber }),
	});
	const entries = [
		...Array.from({ length: 10 }, (_, i) =>
			okEntry(problemEntry({ noteNumber: i + 1 })),
		),
		...Array.from({ length: 12 }, (_, i) => unknown(100 - i)),
		unknown(),
	];
	const g = lookupGroup("npm", entries, {});
	expect(g.shown.length).toBe(10);
	expect(g.notShown).toBe(0);
	expect(g.unknownFormat.count).toBe(13);
	expect(g.unknownFormat.noteNumbers).toEqual([
		89, 90, 91, 92, 93, 94, 95, 96, 97, 98,
	]);
});
test("no entry is left out because of its mark", () => {
	const entries = [
		problemEntry({ noteNumber: 1, resolved: { time: T0 + 10 } }),
		problemEntry({ noteNumber: 2 }),
	].map(okEntry);
	const g = lookupGroup("npm", entries, {});
	expect(g.shown.map((s) => [s.entry.noteNumber, s.mark])).toEqual([
		[2, "unknown"],
		[1, "resolved"],
	]);
	expect(lookupGroup("npm", entries, { group: 1 }).unknownFormat).toEqual({
		count: 0,
		noteNumbers: [],
	});
});
test("a reply group number must be a non-negative integer too", () => {
	for (const group of [-2, 0.5, Number.NaN])
		expect(() => listReplies([reply(3, 1, false)], 1, group)).toThrow(
			RangeError,
		);
});
test("replies are listed oldest first, in bounded groups", () => {
	const entries: Entry[] = [
		reply(9, 1, false),
		reply(3, 1, false),
		reply(5, 2, false),
		problemEntry({ noteNumber: 1 }),
		...Array.from({ length: 10 }, (_, i) => reply(20 + i, 1, false)),
	];
	const first = listReplies(entries, 1);
	expect(first.shown.map((r) => r.noteNumber)).toEqual([
		3, 9, 20, 21, 22, 23, 24, 25, 26, 27,
	]);
	expect(first.notShown).toBe(2);
	expect(listReplies(entries, 1, 1).shown.map((r) => r.noteNumber)).toEqual([
		28, 29,
	]);
	expect(listReplies(entries, 7).shown).toEqual([]);
});
```

- [ ] **Step 2: Run to see them fail** — `bun test src/core/order.test.ts src/core/lookup.test.ts`, expected FAIL, modules not found.

- [ ] **Step 3: Implement `order.ts` and `lookup.ts`** to the rules above.

- [ ] **Step 4: Run the full gate**

Run: `just fmt && just check-fast`
Expected: typecheck, lint, every test (including `src/index.test.ts` and `tests/gate/`) and the secret scan pass.

- [ ] **Step 5: Commit**

```bash
git add src/core && git commit -m "Add the order of a lookup and what it lists to the mailbox core"
```

---

## What this plan proves, against 13.1

| 13.1 item                                                                                                                                                                                                                                            | Task |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Each forbidden category removed, each line-end form one line feed, not normalised, a cut never splits a code point (7.1)                                                                                                                             | 1    |
| A look-alike spelling folds (the tag rules themselves come later) (7.4)                                                                                                                                                                              | 2    |
| Out-of-set and over-long versions refused; `v1.2.3` equals `1.2.3` and orders; a pre-release before its release; build metadata ignored; the two not-comparable pairs (12.1, 12.4)                                                                   | 3    |
| Installed version unknown with two recorded versions; a malformed explicit version refused (12.4)                                                                                                                                                    | 3    |
| Each rule of 6.2 rule 7; `npm/MEAN` and `npm/mean`; go path case; `gopkg.in` loses `.v2`; SSH and HTTPS forms give one `tool` address; rejected characters and segments                                                                              | 4, 5 |
| A draft with a forbidden character is fixed, an over-long one refused; a non-conforming write rejected unchanged; a non-conforming object shown stripped under the notice; an unparseable one a failed check; an unknown format prints nothing (7.1) | 6, 7 |
| A burst does not cancel a resolved mark and does not raise the highest confirmed version; rows dropped in the stated order (12.3)                                                                                                                    | 8, 9 |
| Each mark, in order, from a digest entry alone; a dropped row contributes to no mark (12.3, 12.4)                                                                                                                                                    | 9    |
| The five order keys, each alone deciding; the worked entry; a disputed note below same-version and unknown; no entry dropped (12.5)                                                                                                                  | 10   |
| Replies oldest first; a reply to a removed note appears in a lookup; unknown-format entries after the order and outside the cap; the entries not shown are reported (6.1, 7.1, 7.2, 9.6)                                                             | 10   |

Not proved here, by design: everything in "Out of this plan".

## Review ledger

Agreement round before writing (second agent, 2026-11-24): L1 agreed; L2 to L7 amended and accepted (encoding and safe integers; entry and note fields; sizes and the cut order; scope; Unicode; name rules).

Builder check (a fresh reviewer with no context) and panel round 1 (second agent), both on commit `81ac352`, 2026-11-24. The builder check built throwaway implementations from the rules: all 82 tests passed, and 558,000 generated addresses stayed fixed when canonicalised twice. All findings FOLDED:

- The test code did not type-check in Tasks 4, 6 and 7 (builder 1): `expect<unknown>(…)`, now a global constraint.
- Invisible and look-alike characters had been written into the plan as the characters themselves (author): restored to escapes, now a global constraint.
- A `go` host that looks like a version (`v8.dev`) was refused (builder 14, panel P1-1): the version-element rules apply only with two or more elements. This corrects the agreed L7 text.
- The `tool` URL rule did not say that user and port are read from the authority only, nor what several `@` mean (P1-2): the three forms are now spelled out.
- Strict entry validation missed an empty summary, a line feed in it and nested unknown fields; `warningTags` must be strings (P1-3, builder 5, 10).
- An empty string in a read object, and a field emptied by stripping, were undefined (P1-4, builder 7): the first is unparseable, a required field emptied by stripping stays empty, an optional one is omitted.
- `parentGone` was optional on every kind (P1-5, builder 3): required on a reply, unknown elsewhere.
- `lookupGroup` could be handed an unparseable entry (P1-6, builder 4, 6): the type `PageEntry` excludes it; any unparseable entry fails its page; the unknown-format list is sorted, then cut, and is the same in every group.
- Untested rules where a wrong implementation would pass (builder 2, 8, 9, 11, 12, 13, 16): tests added for the lone carriage return, the upper bound and the members of mark 2, mark 1 over marks 2 and 3, adjacent order keys in conflict, burst votes in row recency, ASCII order and long numeric identifiers, the result length, the order of failures.
- Wording (builder 13, 15, 17): the six legacy npm characters and why `~` is accepted; the order of the length checks; the generated file is committed as formatted; fixture defaults.
- Not changed (builder 14, first point): the clause that a stripped `gopkg.in` element must not end in `.vN` again is unreachable but harmless, and stays as the agreed text has it.

Round 2, on commit `896ae5d`, 2026-11-24: the second agent's narrow panel (one finding; its six round-1 findings otherwise closed; the changed `go` and `tool` rules checked against all Task 5 tests and 38 probes) and a second fresh reviewer, who again built throwaway implementations: 100 tests passed, none failed, about 1.7 million accepted `go` and `tool` addresses were fixed points, and `tsc` reported 11 errors, all one cause. FOLDED:

- The lookup tests typed their entries as `ReadResult<Entry>` while `lookupGroup` takes `PageEntry` (panel P2-1, reviewer): the tests and Task 10's Consumes line now use `PageEntry`.
- `fixtures.ts` was described, not given (reviewer): it is now one block.
- Choices the reviewer had to guess (reviewer 1 to 7): a wrong-typed or empty `version` is `bad-version`; `version` is not a text field for stripping or the total; `canOrder` needs a version that passes 12.1; `group` and `maxRows` out of range throw; `kinds` does not change the unknown-format report; the remote `tool` form has no port.

After that fold the author added tests for the four rules it had stated without one (a non-string version, the row bound, the group number and `kinds`, digits in the remote `tool` form), named three requirements of cited sections under "Out of this plan", and made the table generator write its own output file.

Round 3, on commit `9b70fdf`, 2026-11-24 (the second agent, narrow, on the changes since round 2): one finding, FOLDED as proposed: the group-number rule covered `lookupGroup` and not `listReplies` (P3-1); both now share it, with a test. P2-1 closed; every added test recomputed; the three out-of-plan lines agree with spec section 15. On the question put to it, the second agent agreed that the remote form `git@host:443/org/repo` is accepted with `443` as a path element.

Not re-read by a reviewer: the one-sentence rule and the test added for P3-1. The author checked that the test file type-checks. The author ran the plan's lookup test, fixtures file and version test in the reviewer's scratch project: `tsc` was clean and 100 tests passed; the one new test (a version longer than 64 characters is never ordered) failed, as it should against throwaway code written before that rule.

## Known consequences, recorded and not fixed here

- Word boundaries follow 12.5 literally, so a combining mark splits a word; full case folding itself can produce one (U+0130 folds to `i` plus U+0307). The second agent named this as an optional clarification of the spec for the owner; it does not block this plan.
- Category membership and NFKC come from the runtime's Unicode version. A client and a service on different versions can disagree about a newly assigned character; that fails closed under 7.1 (the service rejects the write, or an older reader strips the character under the notice). Compiled binaries pin one runtime. Task 2's test fails when Bun moves to a newer Unicode than the checked-in table.
- npm packages named with `! ' ( ) *` (legacy only) have no box.
- A `tool` host needs a dot, so an internal host name has no box.
