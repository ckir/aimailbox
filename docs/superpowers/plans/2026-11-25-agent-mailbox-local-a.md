# Agent Mailbox, Local Slice A (plan 2a): Pure Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure, I/O-free logic that the local-only client of plan 2 needs: the default-ignorable rule of 7.1, the warning-tag rules (7.4), the outgoing scanner (8.1), policy resolution (8.4), the untrusted envelope and the rendered lookup (7.2, 7.3), installed-version detection from lock files (12.4), and one parked fix to status data.

**Architecture:** Everything lives in `src/core/`, one file per responsibility with its test beside it, as in plan 1. Core code takes every input as an argument (text, environment values, directories, remotes, file contents, a random boundary, the clock) and returns plain values. The client of plan 2b (`src/client/`) will do the reading of files, git, environment and randomness and call these functions; nothing here does.

**Tech Stack:** TypeScript on Bun 1.4.4 (Unicode 17.0), `bun:test`, Biome, `tsc --noEmit`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-23-agent-mailbox-design.md` (revision 9, on `main` at `1c5b782`). Section numbers below refer to it. Executors read both. The harness facts are in `docs/superpowers/specs/2026-11-25-harness-source-checks.md`; this plan needs none of them.

## Where this plan sits

Plan 2 (spec section 15, "Order of work") was cut by the owner on 2026-11-25 ("Yes, approve B with the four terms") into three plans, each written only after the previous one is merged, so that it can cite real code:

- **2a (this plan):** pure logic in `src/core/`.
- **2b:** the client's state and flows in `src/client/` (store, policy and veto files, draft lock, lookup and send over local notes, the command-line surface). Not written yet. It starts with the output formats of the send flow and the text of the always-on rule, drafted and read by both agents before anything is built (term 1 of the cut).
- **2c:** `setup`, `uninstall`, the always-on rule for both harnesses, dogfooding. The gate hooks and the confirmation are plan 5, not 2c.

The four terms of the cut that bind this plan: the scanner returns structured replacement spans (Task 3); version detection reads only `package-lock.json` (lockfile version 2 or 3), `Cargo.lock` and `go.mod`, and says "unknown" for anything else (Task 6); the line-level plan of 2b waits for this one to merge; no gate or confirmation code here.

**What exists now (verified 2026-11-25 on `main` at `1c5b782`):** `src/core/` holds 13 production files and their tests: `address.ts` (`canonicalise`, `isCanonical`, `ecosystemOf`, `formatNoteId`, `parseNoteId`), `ecosystem.ts`, `entry.ts` (`Entry`, `PageEntry`, `readDigestPage`), `fold.ts` (`foldText`, `wordsOf`, `queryWords`, `countMatches`), `limits.ts` (`LIMITS`, `WARNING_TAGS`, `WarningTag`, `FORMAT_VERSION`), `lookup.ts` (`LookupGroup`, `lookupGroup`, `listReplies`), `mark.ts` (`Mark`, `markEntry`), `note.ts`, `order.ts`, `result.ts` (`Result`, `ReadResult`), `status.ts` (`deriveStatus`, `Vote`), `text.ts` (`stripForbidden`, `isConforming`, `normalizeLineEnds`, `utf8Length`, `codePointLength`, `cutToBytes`, `cutToCodePoints`), `version.ts` (`isValidVersion`, `stripLeadingV`, `canOrder`, `compareVersions`, `versionsEqual`, `rowKey`, `rowVersion`, `resolveInstalled`), plus `fixtures.ts` and `casefold-data.ts`. `src/index.ts` exports one constant. There is no `src/client/`.

Measured for this plan (2026-11-25, Bun 1.4.4):

- `canonicalise("tool/" + remote)` turns `https://GitHub.com/Me/Repo.git`, `git@github.com:me/repo.git`, `ssh://git@github.com:22/me/repo` and `github.com/me/repo` into the same `tool/github.com/me/repo`. Task 4 uses it to compare remotes.
- `/\p{Default_Ignorable_Code_Point}/u.test("\u3164")` is true: the property escape works in the runtime.
- `deriveStatus("tool", [v+64x, 64x])` (a vote whose version is "v" plus 64 characters, 65 in all, and one of 64) gives one row of 65 characters, and the reverse vote order gives one row of 64: a version that is invalid as written (12.1) is counted into a row. Task 7 fixes it.

## Global Constraints

- Bun only: `bun test`, `bun run --bun`; tasks run through `just` (`just test`, `just typecheck`, `just lint`, `just fmt`, `just check-fast`).
- Product tests live next to the code in `src/` (project `CLAUDE.md`).
- No new dependency, no new config file, no change to gated files (`justfile`, `lefthook.yml`, `.lefthook/`, `tsconfig.json`, `biome.json`, `package.json`).
- Core production files import nothing but other `src/core/` files: no `bun:*`, no `node:*`, no `fetch`, no file, clock, random or environment access. Time, randomness and environment are always arguments.
- `tsconfig.json` has `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `allowImportingTsExtensions`: import with the `.ts` extension and `import type` for types.
- Never commit a token-shaped literal, even a fake one: the secret scan rejects it. Tests in this plan build every secret-shaped string at run time through `src/core/secret-fixtures.ts` (Task 3).
- Test code compares a `Result` or `ReadResult` with a plain literal through `expect<unknown>(...)`: `toEqual` is typed from the value under test, and `just typecheck` (run by the pre-commit hook) rejects a literal of another shape.
- In source files every invisible, private-use, unassigned or look-alike character is written as a `\u` escape, never as the character itself (the Write tool turns an escape in its content into the literal character: write such characters as ASCII tokens such as `@@U3164@@`, convert them with a script and scan the file for non-ASCII before committing). The only non-ASCII characters typed literally in tests are ordinary visible letters.
- Every size and threshold is `[PROPOSED, UNMEASURED]` and lives only in `src/core/limits.ts`; no other file holds a number from that list. This plan adds the entries named in each task.
- A property whose value is `undefined` is treated as absent everywhere.
- Rejected, never repaired: a field, rule or file that fails validation is refused; nothing is trimmed or corrected (7.1, 12.1).
- Run `just fmt` before `just lint`. Run `just check-fast` before every commit and `just check` before the last. Commit after every task with the attribution line the session gives.
- Branch: a new branch from `main`, for example `feat/mailbox-local-a`. Do not push or open a pull request without asking the owner.

## Review Focus

Failure modes the spec implies that no single task's happy path exercises, most likely first. Each has a test named in the task that owns the code.

1. A hostile draft hides a secret or a home path behind a look-alike or zero-width character, so a rule misses it (7.1, 8.1). Task 1 removes default-ignorable characters from drafts; Task 3 scans the exact stripped bytes and Task 2 matches tags on the folded copy.
2. A scan hit must never put the secret into an error, a log line or a returned value (8.1: "naming the rule that matched; nothing is sent and nothing is saved"). Task 3 test: the `secret` outcome contains rule names only, and no returned string contains any 8 consecutive characters of the secret.
3. Two policy rules with different modes match one call, or a rule matches a sibling directory with a shared name prefix (`/work/app` against `/work/application`). Task 4 tests both.
4. A lock file carries one version of the box in one place and another in a nested place, or a range, or a format the grammar does not know (12.4). Task 6 returns "unknown" for each and never guesses.
5. A boundary of the envelope appears inside the text it wraps, or the text is over the cap (7.3). Task 5 refuses the first and cuts the second inside the block.

---

### Task 1: The default-ignorable rule of 7.1

Owner: plan 2 task 1, as section 15 says. It changes what a reader and a writer accept (revision 8), so the pin in `property.test.ts` turns from `test.failing` into `test`.

**Files:**

- Modify: `src/core/text.ts:1-2` (the `FORBIDDEN` pattern and its comment)
- Modify: `src/core/text.test.ts` (new tests)
- Modify: `src/core/property.test.ts:142` (the comment above `FORBIDDEN`), `:232-236` (the comment and the `test.failing` call), and the `UNITS` constant

**Interfaces:**

- Consumes: nothing new.
- Produces: `stripForbidden`, `isConforming` (and through `cleanText` in `note.ts`, the reading and writing paths) now treat every code point with the Unicode property Default_Ignorable_Code_Point as forbidden. No signature changes.

- [ ] **Step 1: Confirm the pin is red the right way**

Run: `bun test src/core/property.test.ts -t "Default_Ignorable_Code_Point"`
Expected: the test named "stripForbidden removes every Default_Ignorable_Code_Point (7.1 revision 8, built in plan 2)" reports as expected-to-fail and passes (it is a `test.failing`).

- [ ] **Step 2: Write the failing unit tests in `src/core/text.test.ts`**

Add, in the style of the file (escapes, not literal characters):

- `test("each default-ignorable code point that the categories leave in is removed", ...)`: for each of `\u034f`, `\u115f`, `\u1160`, `\u17b4`, `\u180b`, `\u3164`, `\ufe00`, `\ufe0e`, `\ufe0f`, `\uffa0`, `\u{e0100}`, `\u{e01ef}`: `expect(stripForbidden("a" + unit + "b")).toBe("ab")` and `expect(isConforming("a" + unit + "b")).toBe(false)`.
- `test("the emoji presentation selectors go, the emoji stays", ...)`: `stripForbidden("\u2764\ufe0f")` is `"\u2764"`; `stripForbidden("\u{1f600}")` is unchanged.
- `test("a visible look-alike filler-free word is untouched", ...)`: `stripForbidden("caf\u00e9 \u4e2d\u6587 ok")` is unchanged.
- `test("a Hangul filler splits nothing after removal", ...)`: `stripForbidden("ab\u3164cd")` is `"abcd"`.

- [ ] **Step 3: Run them; they fail**

Run: `bun test src/core/text.test.ts`
Expected: FAIL on the first two new tests (the units are kept today).

- [ ] **Step 4: Extend `FORBIDDEN` in `src/core/text.ts`**

Add `\p{Default_Ignorable_Code_Point}` to the character class, inside the same `(?![\n\t])[...]` lookahead structure, keep the `gu` flags, and update the comment to name the property and 7.1. Do not add a second regular expression: one pattern, so `stripForbidden` stays one pass.

- [ ] **Step 5: Run the text tests; they pass**

Run: `bun test src/core/text.test.ts`
Expected: PASS.

- [ ] **Step 6: Turn the pin into a test and keep the generators honest**

In `src/core/property.test.ts`: change `test.failing(` to `test(` on the pin at line 236 and delete the three comment lines above it that say it fails today; change the comment above `FORBIDDEN` (line 142) to say the list is Cc, Cf, Cs, Co, Cn, Zl, Zp; add `...DEFAULT_IGNORABLE.map((s) => ({ s, forbidden: true }))` to `UNITS` so the first property of the `text` describe block covers them; leave `KEPT`, `FORBIDDEN` and `WELL_FORMED` as they are.

- [ ] **Step 7: Run the whole suite**

Run: `just test`
Expected: all pass, 0 fail. If another test breaks because it used a default-ignorable character as allowed text, STOP and report `[test] -> [needed change] because <reason>`: the oracle is 7.1 revision 8 and the pin by name "stripForbidden removes every Default_Ignorable_Code_Point (7.1 revision 8, built in plan 2)", not the old test.

- [ ] **Step 8: Prove the new test is not vacuous**

Temporarily remove `\p{Default_Ignorable_Code_Point}` from the pattern; `just test` must fail in both `text.test.ts` and the pin of `property.test.ts`. Restore it.

- [ ] **Step 9: Commit**

```bash
just fmt && just check-fast
git add src/core/text.ts src/core/text.test.ts src/core/property.test.ts
git commit -m "Forbid every Default_Ignorable_Code_Point in stored text (7.1, revision 8)"
```

---

### Task 2: Warning tags

**Files:**

- Create: `src/core/tags.ts`
- Create: `src/core/tags.test.ts`

**Interfaces:**

- Consumes: `foldText(text: string): string` from `fold.ts`; `WARNING_TAGS`, `WarningTag` from `limits.ts`.
- Produces: `computeTags(text: string): WarningTag[]`. The result holds each tag at most once, in the order of `WARNING_TAGS`. It is computed on `foldText(text)`, which is never stored or shown (7.4). A tag only warns: no value of this function means "safe".

- [ ] **Step 1: Write the failing tests in `src/core/tags.test.ts`**

For each of the five tags, one `test` named after the tag with at least three texts that must give it and two near-misses that must not (exact samples below; add more in the same style if the implementer sees a plain gap):

| tag                    | must give it                                                                                                                                      | must not                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `network-or-install`   | `curl -fsSL https://example.test/x`, `npm install left-pad`, `pip install --user foo`, `go get example.test/m`                                    | `the installed version is 1.2`, `a curly brace`, `network error in the test`                                  |
| `config-or-credential` | `export FOO=bar`, `set the api key in .env`, `git config --global user.name x`, `npm config set registry x`                                       | `the key of the map`, `a configuration of two servers`                                                        |
| `disables-check`       | `git commit --no-verify`, `disable the lint check`, `skip the tests`, `strict-ssl=false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `// @ts-expect-error` | `the check passed`, `verify the result`                                                                       |
| `indirect-execution`   | `curl x \| sh`, `eval "$X"`, `echo aGk= \| base64 -d`, `python -c "print(1)"`, `bash -c 'ls'`                                                     | `the shell was slow`, `executed in 3 ms`                                                                      |
| `edits-executable`     | `edit .git/hooks/pre-commit`, `add a step to .github/workflows/ci.yml`, `append to deploy.sh`, `chmod +x run.sh`, `edit setup.py`                 | `the hook function returned`, `a workflow of three steps`, `edit src/index.ts`, `modify the parser in lib.py` |

Also:

- `test("a result lists each tag once, in the order of WARNING_TAGS")`: a text matching all five returns exactly `WARNING_TAGS` as an array; a text matching `indirect-execution` then `network-or-install` returns them in vocabulary order.
- `test("empty text and plain prose give no tags")`: `computeTags("")` and `computeTags("it crashes on the second call")` are `[]`.
- `test("a look-alike spelling still gets its tag (7.4)")`: the fullwidth spelling `"\uff43\uff55\uff52\uff4c http://example.test"` and the mixed-case `"CURL -s x"` both give `network-or-install`. (`\uff43\uff55\uff52\uff4c` is the fullwidth word `curl`.)
- `test("tags are computed per call from the text alone")`: calling twice with the same text gives equal arrays and the input string is unchanged.

- [ ] **Step 2: Run to see them fail**

Run: `bun test src/core/tags.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `computeTags` in `src/core/tags.ts`**

The rule set is fixed here, so the implementer writes the table, not the logic: a `Record<WarningTag, readonly RegExp[]>` of the patterns below, tested with `.some` against `foldText(text)`, then filtered through `WARNING_TAGS` for order. Every pattern is ASCII, written for the folded (lower-case, NFKC) copy, no `i` flag needed. The rule set is the "gate's classification and tag rules" that section 15 leaves to the builder: coarse, best effort (9.2 rule 4), and a later change to it needs no format change because the client recomputes tags.

```ts
// network-or-install
/\b(?:curl|wget|ncat|netcat|telnet|scp|sftp|rsync)\s/
/\bssh\s+\S/
/\b(?:npm|pnpm|yarn|bun|pip3?|pipx|uv|cargo|gem|brew|apt|apt-get|dnf|yum|apk|choco|winget|go)\s+(?:-\S+\s+)*(?:install|add|i|get)\b/
/\buv\s+(?:pip|tool)\s+install\b/
/\b(?:npx|bunx|pnpx|uvx)\s/
/\bpipx\s+run\b/
/\b(?:docker|podman)\s+(?:pull|run)\b/
/\bgit\s+(?:clone|fetch|pull)\b/
/\b[a-z][a-z0-9+.-]*:\/\/[^\s/]/

// config-or-credential
/\b(?:export|setenv|setx)\s+[a-z_][a-z0-9_]*(?:=|\s)/
/\$env:[a-z_]/
/(?:^|[\s"'=\/])\.(?:env|npmrc|netrc|pypirc|bashrc|zshrc|profile|gitconfig)\b/
/(?:^|[\s"'=])(?:~|\$home)?\/?\.(?:aws|ssh|gnupg|config)\//
/\bgit\s+config\b/
/\b(?:npm|yarn|pnpm)\s+config\s+set\b/
/\b(?:api[_ -]?key|access[_ -]?key|secret[_ -]?key|auth[_ -]?token|password|passwd|credentials?|private[_ -]?key)\b/

// disables-check
/--no-(?:verify|check|checks|gpg-sign|sandbox|audit|lint|test|tests|hooks|strict|verification)\b/
/--(?:insecure|unsafe|force|dangerously-[a-z-]+|skip-[a-z-]+)\b/
/\b(?:disable|disabling|disabled|turn(?:ing)? off|skip|skipping|bypass|bypassing|ignore|ignoring)\s+(?:the\s+|all\s+|any\s+)?(?:checks?|lint(?:ing|er)?|tests?|hooks?|verification|signatures?|security|ssl|tls|certificates?|sandbox|safety|audit|typecheck|type[ -]check)\b/
/\b(?:strict-ssl|sslverify|verify|check_hostname|rejectunauthorized)\s*[=:]\s*(?:false|0|no|off)\b/
/\bnode_tls_reject_unauthorized\s*=\s*0\b/
/\b(?:nolint|noqa)\b|@ts-(?:ignore|nocheck|expect-error)|eslint-disable|biome-ignore/

// indirect-execution
/\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish|dash|ksh|python3?|node|bun|perl|ruby|pwsh|powershell)\b/
/\beval\b/
/\bbase64\s+(?:-d|-D|--decode)\b/
/\b(?:sh|bash|zsh|dash)\s+-[a-z]*c\b/
/\b(?:python3?|node|ruby|perl|php)\s+-[ce]\b/
/\$\(/
/\bxargs\b/
/\b(?:iex|invoke-expression)\b/
/\bsudo\s/
/\bopenssl\s+enc\b|\bxxd\s+-r\b|\bzcat\b|\bgunzip\b/

// edits-executable
/(?:^|[\s"'\/])(?:\.git\/hooks|\.husky|\.lefthook|lefthook\.yml|\.pre-commit-config\.yaml|\.github\/workflows|\.gitlab-ci\.yml|\.circleci|jenkinsfile|justfile|makefile|dockerfile|hooks\.json|setup\.py|conftest\.py|build\.rs|rakefile|gruntfile|gulpfile)\b/
/\b(?:edit|edits|editing|modify|modifying|patch|patching|append|appending|add|adding|write|writing|create|creating|replace|replacing|change|changing|overwrite|overwriting)\b[^\n]{0,60}\.(?:sh|bash|zsh|ps1|bat|cmd)\b/
/\bchmod\s+(?:[ugoa]*\+x|[0-7]*[1357][0-7]{0,2})\b/
/\b(?:postinstall|preinstall|crontab)\b/
```

- [ ] **Step 4: Run to see them pass**

Run: `bun test src/core/tags.test.ts`
Expected: PASS. If a listed near-miss fails, the pattern is wrong, not the test: tighten the pattern. If a listed must-give text fails, STOP and report `[pattern] -> [yours] because <reason>`.

- [ ] **Step 5: Prove non-vacuity**

Delete one pattern per tag in turn: the tests for that tag must fail. Restore.

- [ ] **Step 6: Commit**

```bash
just fmt && just check-fast
git add src/core/tags.ts src/core/tags.test.ts
git commit -m "Compute the five warning tags from the folded text (7.4)"
```

---

### Task 3: The outgoing scanner

**Files:**

- Modify: `src/core/limits.ts` (new entries in `LIMITS`)
- Create: `src/core/secret-fixtures.ts` (test-only helper, like `fixtures.ts`)
- Create: `src/core/scanner.ts`
- Create: `src/core/scanner.test.ts`

**Interfaces:**

- Consumes: `stripForbidden`/`isConforming` are not called here: the draft arrives already stripped (8.2: the client removes forbidden characters before it scans). `foldText` from `fold.ts` for case-insensitive name matching.
- Produces:

```ts
export type ScanContext = {
	homeDirs: readonly string[];   // the home directory as given and resolved
	workDirs: readonly string[];   // the call directory, the workspace root, both as given and resolved
	userNames: readonly string[];
	hostNames: readonly string[];
	privateRemotes: readonly string[];       // each already reduced to canonical "host/path" (lower case)
	nonDefaultBranches: readonly string[];
	privatePackageNames: readonly string[];
	env: readonly { name: string; value: string }[]; // the process environment
};
export type ContextKind = "home-dir" | "work-dir" | "user-name" | "host-name" | "private-remote" | "branch" | "private-package";
export type ContextFinding = {
	kind: ContextKind;
	/** UTF-16 code-unit indices into the scanned text, end exclusive; null when the hit was found only on the folded copy and has no place in the raw text. */
	span: { start: number; end: number } | null;
	fix?: string;   // a fixed replacement, present only for a located home-dir ("~") or work-dir ("<workspace>")
};
export type ScanOutcome =
	| { outcome: "secret"; rules: string[] }          // rule names only, sorted, no offsets, no matched text
	| { outcome: "context"; findings: ContextFinding[] } // located ones sorted by start, none overlapping, then the unlocated ones
	| { outcome: "clean" };
export function scanOutgoing(text: string, context: ScanContext): ScanOutcome;
/** Applies every located finding that has a `fix`, right to left; the others are left in place. */
export function applyFixes(text: string, findings: readonly ContextFinding[]): string;
/** True when every finding has a fix, so that applyFixes leaves no context behind (8.1: "mechanical paths are offered a fixed redaction"). */
export function isMechanical(findings: readonly ContextFinding[]): boolean;
export const SECRET_RULES: readonly string[]; // the names below, in the order below
```

New `LIMITS` entries, all `[PROPOSED, UNMEASURED]`: `scanEnvSecretNamedMinChars: 8`, `scanEnvEntropyMinChars: 20`, `scanEntropyBitsPerChar: 3.5`, `scanContextNameMinChars: 3`.

**Rules fixed by this plan.** `SECRET_RULES` and their patterns (run on the exact text, no folding):

| rule name           | pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private-key-block` | `-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `aws-access-key-id` | `\b(?:AKIA\|ASIA)[0-9A-Z]{16}\b`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `github-token`      | `\bgh[pousr]_[A-Za-z0-9]{36,}\b` and `\bgithub_pat_[A-Za-z0-9_]{50,}\b`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `slack-token`       | `\bxox[abprs]-[A-Za-z0-9-]{10,}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm-token`         | `\bnpm_[A-Za-z0-9]{36}\b`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `api-key-prefix`    | `\bsk-[A-Za-z0-9_-]{20,}`, `\bsk_live_[A-Za-z0-9]{16,}`, `\bAIza[0-9A-Za-z_-]{35}\b`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `jwt`               | `\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `bearer-header`     | `(?:authorization\|proxy-authorization)\s*:\s*(?:bearer\|basic)\s+[A-Za-z0-9._~+/=-]{16,}` (case-insensitive)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `url-credentials`   | `://[^/\s:@]+:[^/\s@]+@`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `secret-assignment` | `\b(?:password\|passwd\|secret\|token\|api[_-]?key\|access[_-]?key\|private[_-]?key)\s*[:=]\s*["']?[^\s"']{12,}` (case-insensitive)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `env-value`         | a `context.env` value of at least `scanEnvSecretNamedMinChars` characters whose name, upper-cased and split on `_`, contains one of the segments `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `PASSPHRASE`, `CREDENTIAL`, `CREDENTIALS`, `AUTH`, `KEY` or the adjacent pair `API` `KEY` or `PRIVATE` `KEY` (so `AUTH_TOKEN`, `MY_API_KEY` and `GH_TOKEN` count, and `GIT_AUTHOR_NAME` and `MONKEY_PATCH` do not), or a value of at least `scanEnvEntropyMinChars` characters whose Shannon entropy per character is at least `scanEntropyBitsPerChar` and which is neither an absolute path (starts with `/` or `~/`) nor a URL (starts with a scheme and `://`); a name in `STANDARD_ENV` (`PATH HOME USER LOGNAME SHELL PWD OLDPWD TERM TMPDIR LANG LANGUAGE EDITOR VISUAL PAGER DISPLAY HOSTNAME SSH_AUTH_SOCK`, and any name starting `LC_` or `GIT_AUTHOR_` or `GIT_COMMITTER_`) is never used. The rule matches when the value occurs in the text as a substring. |

**Context rules** (checked only when no secret rule matched):

- `home-dir` and `work-dir`: each non-empty entry of `homeDirs` / `workDirs` found as a substring (case-sensitive); the fix is `~` for a home directory and `<workspace>` for a work directory. Overlapping hits resolve longest first, so `/home/u/app` (work) wins over `/home/u` (home) at the same start.
- `user-name`, `host-name`, `branch`, `private-package`: each entry of at least `scanContextNameMinChars` characters found with a boundary on both sides (the characters before and after are not `[A-Za-z0-9_.-]`). Two passes: first on the raw text, case-insensitively by lower-casing each side one code point at a time and only where that keeps its UTF-16 length, which gives located spans; then on `foldText(text)` against `foldText(entry)`, and every folded hit beyond the number of raw hits of the same entry becomes one finding with `span: null` (a look-alike spelling is caught, but cannot be located). No fix.
- `private-remote`: each canonical `host/path` entry found as a substring, case-insensitively in the same length-keeping way, also in the `host:path` form; no fix. Located only.

- [ ] **Step 1: Write `src/core/secret-fixtures.ts`**

A test-only module exporting `fakeSecret(kind: string): string` for each rule name above that has a fixed shape (`aws-access-key-id`, `github-token`, `slack-token`, `npm-token`, `api-key-prefix`, `jwt`, `private-key-block`), building the string at run time from a prefix plus `crypto.getRandomValues` characters, as `tests/toolchain/helpers.ts` `fakeToken()` does. Its header comment says it is for tests only. No token-shaped literal appears in the file: prefixes are split (for example `"AK" + "IA"`).

- [ ] **Step 2: Write the failing tests in `src/core/scanner.test.ts`**

- one `test` per secret rule: a draft sentence carrying the fake secret gives `{outcome:"secret", rules:[<that rule name>]}`; and one near-miss that must be `clean` or context (for example a 10-character `ghp_` string for `github-token`, `password = x` for `secret-assignment`).
- `test("a secret result carries rule names only")`: for every rule, `JSON.stringify(result)` contains no run of 8 consecutive characters of the secret.
- `test("a secret wins over context")`: a text with a home directory and a token returns `secret`.
- `test("the env-value rule uses secret-named and high-entropy values and skips standard variables")`: a secret-named variable of 8 or more characters is found in the text; a 7-character one is not; a 20-character random value is found; `PATH` and `LC_ALL` values never are; a value that does not occur in the text is not a hit.
- `test("home and work directories get their fixed fixes")`: text `"see /home/u/app/src/x.ts and /home/u/.npmrc"` with `homeDirs:["/home/u"]`, `workDirs:["/home/u/app"]` gives two findings (`work-dir` at the longer match, `home-dir`), `isMechanical` true, `applyFixes` gives `"see <workspace>/src/x.ts and ~/.npmrc"`.
- `test("a user name is matched on word boundaries and has no fix")`: user name `alice` is found in `"alice reported"` and `"by Alice"`, not in `"malice"` or `"alicenet"`; `isMechanical` false; `applyFixes` returns the text unchanged.
- `test("a private remote is found in the URL and the scp forms")`: canonical `github.com/me/private` is found in `https://github.com/Me/Private.git` and `git@github.com:me/private`.
- `test("findings are sorted and do not overlap")` for a text with three kinds of hit.
- `test("a look-alike user name is found without a span")`: user name `alice` and the text `"by \uff41\uff4c\uff49\uff43\uff45 yesterday"` (fullwidth letters) give one `user-name` finding with `span: null`; `isMechanical` is false; `applyFixes` returns the text unchanged.
- `test("an upper-case name is located on the raw text")`: `ALICE` found for `alice` with the right span; a text where `foldText` changes the length (a ligature before the name) still gives the right raw span.
- `test("GIT_AUTHOR_NAME and SSH_AUTH_SOCK are not secret-named")`: a draft that names the author, with `GIT_AUTHOR_NAME` set to a name of 8 or more characters, is not `secret`; `AUTH_TOKEN` of 8 or more characters occurring in the text is.
- `test("a high-entropy path or URL value is not an env-value hit")`.
- `test("a clean text is clean")`: prose with a public package name and a version.
- `test("names under the minimum length are ignored")`: a 2-character user name never matches.
- `test("an empty context finds only secrets")`.

- [ ] **Step 3: Run to see them fail**

Run: `bun test src/core/scanner.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `scanOutgoing`, `applyFixes`, `isMechanical`, `SECRET_RULES` in `src/core/scanner.ts`**

Entropy is Shannon entropy over the value's characters (code points). Collect secret rule names into a set, return sorted. For context, gather all hits, then sort by `start` ascending and, at an equal start, by length descending, and drop any hit that begins before the previous kept hit ends. `applyFixes` works from the last finding to the first so earlier offsets stay valid. Offsets are UTF-16 code-unit indices (a deliberate choice: the draft is a JavaScript string; 2b converts to bytes if it needs them).

- [ ] **Step 5: Run to see them pass**

Run: `bun test src/core/scanner.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove non-vacuity**

Disable each secret rule in turn (comment out its pattern): its test must fail. Search names on the folded text only and report its offsets: the ligature test must fail. Change a boundary check to always true: the `malice` test must fail. Return the matched text in the `secret` result: the 8-character test must fail. Restore.

- [ ] **Step 7: Commit**

```bash
just fmt && just check-fast
git add src/core/limits.ts src/core/secret-fixtures.ts src/core/scanner.ts src/core/scanner.test.ts
git commit -m "Scan outgoing text for secrets and local context, with fixed redaction spans (8.1)"
```

---

### Task 4: Policy resolution

**Files:**

- Create: `src/core/policy.ts`
- Create: `src/core/policy.test.ts`

**Interfaces:**

- Consumes: `canonicalise(input: string): Result<string, AddressError>` from `address.ts`; `Result` from `result.ts`.
- Produces:

```ts
export type PolicyMode = "deny" | "confirm-each" | "allow";
export type PolicyRule = { directory: string } | { remote: string }; // exactly one key
export type PolicyEntry = PolicyRule & { mode: PolicyMode; unattendedPostRead?: boolean };
export type Policy = {
	formatVersion: 1;
	defaultMode: PolicyMode;
	unattendedPostRead: boolean;
	rules: PolicyEntry[]; // a remote is stored as canonical "host/path"
};
export type PolicyError = "not-an-object" | "unknown-format" | "bad-field";
export const DEFAULT_POLICY: Policy; // default deny, no rules, unattendedPostRead false
export function readPolicy(value: unknown): Result<Policy, PolicyError>;
export type Call = { directory: string; remotes: readonly string[]; vetoed: boolean };
export type Resolution = { mode: PolicyMode; vetoed: boolean; unattendedPostRead: boolean };
export function resolvePolicy(policy: Policy, call: Call): Resolution;
export type Permission = "yes" | "needs-human" | "no";
export function policyPermission(resolution: Resolution, operation: "retraction" | "other"): Permission;
```

Semantics, from 8.4:

- `readPolicy` is strict because it reads a file the human wrote and a typo could loosen it: an unknown field anywhere, an unknown mode, a non-boolean flag, a `directory` that is not an absolute path (it must start with `/`, contain no `.` or `..` segment and no NUL), a `remote` that `canonicalise("tool/" + remote)` refuses, an entry with both or neither of `directory` and `remote` are `bad-field`; a `formatVersion` other than 1 is `unknown-format`; a non-object is `not-an-object`. A trailing `/` on a directory is dropped (the root `/` stays `/`).
- `resolvePolicy`: a directory rule matches when the call directory equals the rule directory or starts with the rule directory followed by `/` (the root matches everything); a remote rule matches when any of the call's remotes, reduced by `canonicalise("tool/" + remote)` and with the `tool/` removed, equals the rule's remote. When no rule matches, the mode is `defaultMode`. When several match, the mode is the most restrictive: `deny` over `confirm-each` over `allow`. `unattendedPostRead` is `policy.unattendedPostRead` and no matching rule has `unattendedPostRead: false`. A vetoed call resolves to `{mode:"deny", vetoed:true, unattendedPostRead:false}` whatever the rules say.
- `policyPermission`: `retraction` is `"yes"` under `deny`, `allow` and a veto, and `"needs-human"` under `confirm-each`; `other` is `"no"` under `deny` and a veto, `"needs-human"` under `confirm-each`, `"yes"` under `allow`. ("yes" is the policy's answer only; the post-read rules of 8.3 and the confirmation of 8.5 apply on top in plan 5. "Allowed under every mode" in 8.4 means the policy never refuses a retraction; under `confirm-each` the same section has the human confirm every outgoing item, and section 8 defines a retraction as one, so it asks.)

- [ ] **Step 1: Write the failing tests in `src/core/policy.test.ts`**

- `readPolicy`: the default policy file `{formatVersion:1, defaultMode:"deny", unattendedPostRead:false, rules:[]}` is read as itself; one test per `bad-field` cause listed above (unknown top-level field, unknown field inside a rule, mode `"Allow"`, relative directory, directory with `..`, remote `"nonsense"`, both keys, neither key, `unattendedPostRead: "yes"`); `formatVersion: 2` is `unknown-format`; `null`, an array and a string are `not-an-object`; a remote written `git@GitHub.com:Me/Repo.git` is stored as `github.com/me/repo`; a trailing-slash directory is stored without it.
- `resolvePolicy`:
  - `test("with no rules the default mode applies")`;
  - `test("a scoped allow works under a default deny")` (rule `/work/app` allow, call in `/work/app/src`: `allow`);
  - `test("a rule for /work/app does not match /work/application")`;
  - `test("a matching deny beats a matching allow, and confirm-each beats allow")` (two directory rules at different depths, then a directory and a remote rule);
  - `test("SSH and HTTPS forms of one remote match alike")` (rule `https://github.com/me/repo`, call remotes `["git@github.com:me/repo.git"]`);
  - `test("a repository with several remotes matches if any one matches")`;
  - `test("the root directory rule matches every call")`;
  - `test("a veto beats a matching allow")`;
  - `test("unattended post-read sends need the opt-in and no matching withhold")` (four combinations);
  - `test("the default mode does not apply when a rule matches")` (default allow, matching deny rule gives deny).
- `policyPermission`: the full table of the six cells for `deny`, `confirm-each`, `allow` and the veto, for both operations.

- [ ] **Step 2: Run to see them fail**

Run: `bun test src/core/policy.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `DEFAULT_POLICY`, `readPolicy`, `resolvePolicy`, `policyPermission` in `src/core/policy.ts`**

No extra design: follow the semantics above. Error causes are not distinguished beyond the three codes.

- [ ] **Step 4: Run to see them pass**

Run: `bun test src/core/policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove non-vacuity**

Replace "most restrictive" with "first match": the deny-beats-allow test must fail. Replace the `+ "/"` boundary with a bare prefix test: the `application` test must fail. Skip canonicalising the call's remotes: the SSH/HTTPS test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
just fmt && just check-fast
git add src/core/policy.ts src/core/policy.test.ts
git commit -m "Read and resolve the machine policy with scoped rules and the veto (8.4)"
```

---

### Task 5: The untrusted envelope and the rendered lookup

**Files:**

- Modify: `src/core/limits.ts` (new entries)
- Create: `src/core/render.ts`
- Create: `src/core/render.test.ts`

**Interfaces:**

- Consumes: `LookupGroup` from `lookup.ts`; `Entry` from `entry.ts`; `Mark` from `mark.ts`; `cutToBytes`, `cutToCodePoints`, `utf8Length` from `text.ts`; `Result` from `result.ts`.
- Produces:

```ts
export type EnvelopeError = "bad-boundary" | "boundary-in-text";
/** The boundary must match /^[0-9a-f]{32,64}$/ (the client makes it from 16 to 32 random bytes per call). */
export function wrapUntrusted(
	text: string,
	boundary: string,
): Result<string, EnvelopeError>;
export function renderSummaryLine(entry: Entry, mark: Mark): string;
export type RenderOptions = {
	address: string; // canonical box address, printed in the header
	boundary: string; // see wrapUntrusted
	group: number; // 0-based index of this group, printed as group+1
	cleaned: boolean; // PageRead.cleaned of any page this group came from
	nextGroupCommand: string; // the exact command text for the next group; supplied by the client
};
export function renderLookup(
	group: LookupGroup,
	options: RenderOptions,
): Result<string, EnvelopeError>;
```

New `LIMITS` entries, `[PROPOSED, UNMEASURED]`: `envelopeBytes: 16384` (the hard cap of 7.3 on the text inside one block) and `summaryLineBytes: 400` (the strict cap of 12.3 on one rendered line).

**Formats fixed by this plan.** Block (`wrapUntrusted`), three parts joined by `\n`:

```
<<untrusted-begin boundary=BOUNDARY>>
TEXT
<<untrusted-end boundary=BOUNDARY>>
```

If `utf8Length(text)` exceeds `LIMITS.envelopeBytes`, the text is cut with `cutToBytes` at `envelopeBytes - 40` bytes (never inside a code point) and the line `[cut: over the size cap]` is appended inside the block. A boundary outside the pattern is `bad-boundary`; a text that contains the boundary string is `boundary-in-text`.

Summary line (`renderSummaryLine`), fields joined by single spaces, empty fields omitted, in this order:

1. `#<noteNumber>` and the kind (`problem`, `question`, `reply`);
2. for a problem or a question, the mark as its token (`resolved`, `not-reproduced-on-newer`, `disputed-on-your-version`, `same-version`, `unknown`); for a reply, `answers-removed-#<parentNoteNumber>` (a reply only reaches a lookup when its parent is gone);
3. for a problem: `confirm=<nonBurstTotal>`, `does-not-reproduce=<nonBurstTotal>` and, for each form whose `burst` flag is set, `burst-confirm` or `burst-does-not-reproduce`; for a problem or a question: `replies=<replyCount>`;
4. `resolved` followed by `-from-<version>` when `resolved.version` is present (this is the resolved mark of the entry, shown whatever the viewer's mark says);
5. `reported=<version>` for a problem with `reportedVersion`, for a question with `version`;
6. `warn=<tag>,<tag>` when `warningTags` is not empty, in vocabulary order. No text such as "safe" or "no warnings" is ever printed (7.4);
7. then the separator (a space, a pipe, a space) and the summary: cut with `cutToCodePoints(summary, LIMITS.summaryCodePoints)`, then with `cutToBytes(summary, LIMITS.summaryLineBytes - utf8Length(<the line so far plus the separator>))`, so the whole line is at most `summaryLineBytes` bytes (a prefix already at or over the cap leaves no summary: `cutToBytes` gives the empty string for a limit below 1). Line feeds in a summary cannot occur (7.1); a summary that nevertheless contains one is cut at it.

Lookup (`renderLookup`), joined by `\n`:

1. header, outside the block: `lookup <address> group <group+1>: showing <shown.length>`;
2. if `cleaned`: `notice: some content did not conform to the reading rules and was cleaned`;
3. the block: `wrapUntrusted` of the summary lines (one per shown entry, in the order given); an empty group gives the block with the line `(no entries)`;
4. if `notShown > 0`: `<notShown> more not shown; next group: <nextGroupCommand>`;
5. if `unknownFormat.count > 0`: `<count> entries need a newer client: #<n>, #<n>` (the listed numbers, then `, and others` when `count` exceeds the numbers listed).
   Nothing but the header, notice, and the two trailing lines is printed outside the block; the block holds everything that came from a note.

- [ ] **Step 1: Write the failing tests in `src/core/render.test.ts`**

Use `workedEntry` and `problemEntry(...)` from `fixtures.ts` (they exist), and build question and reply entries with the `Entry` types.

- `wrapUntrusted`: the three-part shape with an exact expected string; `bad-boundary` for 31 hex characters, for uppercase, for non-hex; `boundary-in-text` when the text holds the boundary; text of exactly `envelopeBytes` bytes is not cut; one byte more is cut, the notice line is inside the block, the output text part is at most `envelopeBytes` bytes plus the notice, and no code point is split (a text of 4-byte characters).
- `renderSummaryLine`: an exact expected line for `workedEntry` with each mark; a question; a reply; a problem with a burst flag shows `burst-confirm`; a resolved entry with a version shows `resolved-from-<v>`; tags appear as `warn=...` in vocabulary order and are absent when empty; the line never contains `safe`; a summary of 120 characters of 4 bytes each is cut so the line is at most `summaryLineBytes` bytes and still ends on a whole code point; counts are the non-burst totals.
- `renderLookup`: an exact expected output for a two-entry group; `cleaned` adds the notice line; `notShown` adds the next-group line with the supplied command text; unknown-format entries add the line, with `, and others` when the count exceeds the listed numbers; an empty group prints `(no entries)` inside the block; a bad boundary returns the error; everything that came from an entry is between the begin and end lines (a test that splits the output on the markers checks the outside holds only the header, notice and trailing lines).

- [ ] **Step 2: Run to see them fail**

Run: `bun test src/core/render.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the three functions in `src/core/render.ts`**

- [ ] **Step 4: Run to see them pass**

Run: `bun test src/core/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove non-vacuity**

Put the summary outside the block in `renderLookup`: the outside-the-block test must fail. Count burst votes in the printed counts: the count test must fail. Drop the byte cut: the 4-byte test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
just fmt && just check-fast
git add src/core/limits.ts src/core/render.ts src/core/render.test.ts
git commit -m "Wrap printed note text in a random-boundary block and render lookup lines (7.2, 7.3)"
```

---

### Task 6: Installed-version detection from lock files

**Files:**

- Modify: `src/core/limits.ts` (one new entry)
- Create: `src/core/detect.ts`
- Create: `src/core/detect.test.ts`

**Interfaces:**

- Consumes: `canonicalise` from `address.ts`; `ecosystemOf` from `address.ts`; `resolveInstalled(ecosystem, explicit, recorded)` and `isValidVersion` from `version.ts`; `Result` from `result.ts`.
- Produces:

```ts
export type WorkspaceFile = {
	name: "package-lock.json" | "Cargo.lock" | "go.mod";
	text: string;
};
/** Every exact version the given files record for this box, in file order; [] when none or when a file is not understood. */
export function recordedVersions(
	address: string,
	files: readonly WorkspaceFile[],
): string[];
/** 12.4 rule 4: the explicit version, else the single recorded one, else undefined. */
export function detectInstalled(
	address: string,
	explicit: string | undefined,
	files: readonly WorkspaceFile[],
): Result<string | undefined, "invalid-version">;
```

New `LIMITS` entry, `[PROPOSED, UNMEASURED]`: `lockFileBytes: 8388608`. A file whose text is over it is not understood.

Grammars fixed by this plan (term 4 of the cut; anything else is "not understood" and gives no versions, so the answer is unknown; the client passes only files at the workspace root, and a file whose `name` is not one of the three is ignored):

- `package-lock.json`, for an `npm/...` box only: `JSON.parse` in a try; the root must be an object with `lockfileVersion` equal to 2 or 3 and a `packages` object; each key `k` of `packages` that is `node_modules/<name>` or ends with `/node_modules/<name>` (the `<name>` taken as everything after the last `node_modules/`, scope included, compared exactly with the box's name) contributes its string `version`, unless the entry has `link: true` or no string `version`. Lockfile version 1, a missing `packages`, or invalid JSON gives `[]`.
- `Cargo.lock`, for a `cargo/...` box only: a line scanner over blocks that start with the line `[[package]]`; within a block the first `name = "<x>"` and `version = "<y>"` lines (exact `key = "value"` with double quotes); a block contributes `<y>` when `canonicalise("cargo/" + x)` equals the box. A block missing either line contributes nothing.
- `go.mod`, for a `go/...` box only: the lines of `require ( ... )` blocks and single-line `require <path> <version>` directives, with a trailing `// ...` comment removed; each contributes `<version>` when `canonicalise("go/" + path)` equals the box (this removes a `/vN` element, so `github.com/a/b/v2 v2.3.0` belongs to `go/github.com/a/b`). `replace`, `exclude`, `retract` and `toolchain` directives are ignored.
- `pypi/...` and `tool/...` boxes: `[]` from files (a `tool` version comes from the call only, `resolveInstalled` says so; PyPI lock files are not in the grammar).

`detectInstalled` is `resolveInstalled(ecosystemOf(address), explicit, recordedVersions(address, files))`. A recorded version that is not valid under 12.1 makes the answer unknown (that is what `resolveInstalled` does), and a range such as `^1.2.0` is not a version, so it is never returned.

- [ ] **Step 1: Write the failing tests in `src/core/detect.test.ts`**

Build lock texts from strings in the test.

- npm: a v3 lock with `node_modules/left-pad` version `1.3.0` gives `["1.3.0"]` for `npm/left-pad`; a scoped name `npm/@scope/pkg` is found under `node_modules/@scope/pkg`; a nested `node_modules/a/node_modules/left-pad` is found too (so two different versions give two entries and `detectInstalled` gives `undefined`); two equal versions at different depths give one answer; an entry with `link: true` contributes nothing; a lookalike name `left-pad-x` or `xleft-pad` is not matched; lockfileVersion 1, a missing `packages` object, invalid JSON and a non-object root give `[]`; a case-different name (`Left-Pad`) is not matched (npm keeps case).
- cargo: a lock with two `[[package]]` blocks of the same crate at two versions gives both; a crate written `my_crate` in the lock matches the box `cargo/my-crate`; a block without a `version` line contributes nothing; a `source` line is ignored.
- go: single-line and block `require`; a `// indirect` comment; `/v2` module path matches the unversioned box; `replace` and `exclude` lines ignored; `v0.0.0-20200101000000-abcdefabcdef` accepted as recorded; a path of another module is not matched.
- ignored: a file with another name; a file over `lockFileBytes`; a `pypi/...` and a `tool/...` box with all three files give `[]`; an npm box given only `Cargo.lock` gives `[]`.
- `detectInstalled`: an explicit valid version wins over the files; an explicit invalid version gives `{ok:false, error:"invalid-version"}`; one recorded version is returned; several distinct are `undefined`; none is `undefined`; a recorded version that is not valid (a range string planted in a lock) gives `undefined`; for a `tool` box the files are not consulted.
- `test("detection never returns a range")`: `"^1.2.0"` and `"~1.2"` planted as a lock's `version` give `undefined`.

- [ ] **Step 2: Run to see them fail**

Run: `bun test src/core/detect.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `recordedVersions` and `detectInstalled` in `src/core/detect.ts`**

Each grammar is its own small function; none executes anything or reads anything beyond its `text`.

- [ ] **Step 4: Run to see them pass**

Run: `bun test src/core/detect.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove non-vacuity**

Match npm names by suffix only (`endsWith(name)`): the lookalike test must fail. Accept lockfile version 1: its test must fail. Drop the `canonicalise` of the cargo name: the `my_crate` test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
just fmt && just check-fast
git add src/core/limits.ts src/core/detect.ts src/core/detect.test.ts
git commit -m "Detect the installed version from package-lock, Cargo.lock and go.mod (12.4)"
```

---

### Task 7: A version invalid as written has no row (parked from plan 1)

The parked item "`deriveStatus("tool", [v + 64x, 64x])` yields a 65-length row key depending on vote order" is a plan-1 defect against 12.3 ("A version that is invalid as written has no row (12.1)"). The service refuses such a vote at write time, so no real digest holds one; this makes the function total instead of order-dependent.

**Files:**

- Modify: `src/core/status.ts` (`tallyRows`)
- Modify: `src/core/status.test.ts` (new tests)

**Interfaces:**

- Consumes: `isValidVersion` from `version.ts`.
- Produces: `deriveStatus` ignores, for the per-version table only, a vote whose `version` is present but not valid under 12.1. The vote still counts in the totals of its form (`formCounts` is unchanged). `highestConfirmedVersion` already skips such a vote (`canOrder` is false for it).

- [ ] **Step 1: Write the failing tests in `src/core/status.test.ts`**

- `test("a vote whose version is invalid as written makes no row, in either vote order")`: for `x = "x".repeat(64)` and the orders `["v" + x, x]` and `[x, "v" + x]` on ecosystem `tool`, the rows are `[{version: x, confirmTotal: 1, ...}]` in both, equal to each other, and `confirm.total` is 2 in both.
- `test("an invalid-version vote still counts in the totals")` with a single invalid vote: `rows` is `[]`, `confirm.total` is 1.

- [ ] **Step 2: Run to see them fail**

Run: `bun test src/core/status.test.ts`
Expected: FAIL on the first new test (the row holds both votes today).

- [ ] **Step 3: Skip the row in `tallyRows`**

In `tallyRows` change the guard `if (vote.version === undefined) continue;` so that a version failing `isValidVersion` is skipped as well. Import `isValidVersion`.

- [ ] **Step 4: Run the suite**

Run: `just test`
Expected: all pass. If an existing test fails because it expects a row for an invalid version, STOP and report `[test] -> [needed change] because <reason>`; the oracle is 12.3 ("A version that is invalid as written has no row") and the plan-1 test audit's parked note.

- [ ] **Step 5: Prove non-vacuity**

Revert the guard: the new tests must fail. Restore.

- [ ] **Step 6: Commit**

```bash
just fmt && just check-fast
git add src/core/status.ts src/core/status.test.ts
git commit -m "Give a vote whose version is invalid as written no table row (12.3)"
```

---

## Finish

After Task 7: run `just check` (it includes the toolchain suite). Then, before the plan is declared complete, the standing disciplines of this repository apply: a convergent AGY-CAPSTONE review of the committed range, then AGY-TEST-AUDIT, each with the verify-before-fold rule, and the owner scopes any gaps. Do not push or open a pull request without asking the owner.

## Rulings made during execution (2026-11-25)

The plan text above is what was reviewed and merged. Executing it with a reviewer after every task found places where the plan text was wrong against the spec, which is the binding authority. Each ruling below overrides the plan text it names and is built and tested. They are listed so that a reader of this plan is not misled and so that plan 2b starts from what exists.

Pre-flight:

- Task 5's envelope cut allowance is computed from the notice (`LIMITS.envelopeBytes - utf8Length(notice) - 1`), not the literal 40.
- Task 3: findings with the same start and length of different kinds are ordered by kind name, ascending.

Task 3 (scanner), after a review that reproduced every case:

- R1 (8.1): the `secret-assignment` pattern has no leading `\b` and allows a closing quote before the separator, so `DB_PASSWORD=...`, `AWS_SECRET_ACCESS_KEY=...` and `{"password": "..."}` are secrets.
- R2: the boundary of a user name, host name, branch or package name is "not `[A-Za-z0-9_]`" on both sides, so `alice.`, `box7.local` and `alice-dev` are found.
- R3 (revised by R19): a home or work directory hit must end at a path boundary (end of text, or not `[A-Za-z0-9_-]` and not `.` followed by one), so `/home/u` is not a hit inside `/home/user/x`.
- R4: when a dropped overlapping hit extends past the kept finding, the kept finding loses its fix.
- R5: the private-key pattern also matches `PRIVATE KEY BLOCK`.
- R6: trailing slashes of directory entries are removed before matching (`/` stays `/`, a slash-only entry becomes `/`).

Task 4 (policy): R7, a call directory that is not an absolute normalised path resolves to deny; R8, with at least one remote rule and any unparsable call remote the mode is capped at confirm-each and unattended post-read sends are off; R9, `DEFAULT_POLICY` is deep-frozen.

Task 5 (render): R10, `summaryLineBytes` is 1024, because the worst validated prefix is 427 bytes and a 120-code-point summary of 4-byte characters is 480; R11, the unknown-format line reads `1 entry needs a newer client` for one, and omits the colon when no numbers are listed.

Task 6 (detect): R12, for npm, cargo and go any recorded version that fails `canOrder` makes the answer unknown (`1.x`, `latest`, `1.2` are not installed versions); R13, an explicit version skips parsing, recorded versions are de-duplicated before resolving, and Cargo multi-line strings are skipped everywhere. Both functions throw for a non-canonical address, as `ecosystemOf` does.

Final whole-branch review: R14, a private remote is matched as host, optional `:port`, then `/`, `:` or `:/`, then the path; R15, a rendered line shows the union of the entry's tags and the client's `computeTags` over the summary and failure signature (7.4); R16, every secret rule and the environment-value check run over the raw text, the stripped text and its NFKC form; R17, a `package-lock.json` entry with a `name` is attributed to that name; R18, a go.mod `replace` of the box makes its version unknown; R19, a directory entry of `/` is ignored and a directory hit needs a leading boundary; R20, `canonicalRemote` is exported from `policy.ts`, `renderLookup` refuses a non-canonical address with `bad-address`, and an unparsable remote beside a matching allow remote gives confirm-each.

Contracts that plan 2b must meet, found by the reviews and not fixable here: rule directories and the call directory must both be resolved (real path, the file system's case rule) before `resolvePolicy`, because the policy compares them as given; entries the client builds from its local store must be cleaned before they are rendered; the client passes only validated canonical addresses and a `nextGroupCommand` built from trusted parts; the scanner needs `privateRemotes` in `host/path` form (use `canonicalRemote`) and must not be given `/` as a work directory.

Capstone rounds 1 to 7 (an adversarial peer reading the committed code; every finding measured before it was folded). The scanner is a heuristic filter, so each round found more credential forms in new families; the fresh-corpus leak rate went from 8 of 30 (round 5) to 4 of 30 (round 6) with 0 of 30 ordinary sentences wrongly refused, and the fold of R41 to R43 was reviewed by round 7 (scoped to that fold, the owner's ruling of 2026-11-25), which found three live gaps (an attached `-p<pass>` flag, a backslash-continued login, Vault batch tokens) and the driver measured four more (Vault recovery tokens, nerdctl, buildah, crane and oras logins); R44 to R46 fold them; the owner then waived any further round. The rulings, all built and tested in `scanner.ts` and `detect.ts`:

- R21, R27: the `bearer-header` schemes are bearer, basic, token, digest, apikey, api-key, negotiate and ntlm after `authorization` or `proxy-authorization`.
- R22, R26, R30: a colon-less URL userinfo of 20 or more characters of `[A-Za-z0-9._~%+=-]` is a secret, and the user part before the colon may be empty (`redis://:pass@host`).
- R23: a quoted value of 12 or more characters, spaces allowed, after a secret keyword is a secret. This refuses ordinary quoted prose such as `password: "see the docs for the rules"` by design: a refusal saves nothing and leaks nothing.
- R24: `_` is not a host character in the private-remote boundary.
- R25: go.mod module paths may be quoted with double quotes or back-quotes, so a quoted `replace` is seen.
- R28, R31, R41: the secret-assignment keywords also cover `passphrase`, `credential(s)`, `account_key`, `sas_token`, `shared_access_key` and `secret_key`; bare `auth` is deliberately not a keyword.
- R29, R33, R34, R37: a `cookie-header` rule for `Cookie` and `Set-Cookie` lines with a 16-character value, skipping the standard attribute names, looking at every pair, with the gap bounded at 2000 characters so the scan stays linear.
- R31: a `docker-auth` rule for `"auth": "<base64>"`; R32, R40, R42: prefixed-key patterns for SendGrid, Stripe restricted, GitLab, PyPI, HuggingFace, DigitalOcean, Shopify, Google OAuth `ya29.`, age and Vault (R44: `hvs.`, `hvb.` and `hvr.`; the legacy Vault `s.` form is left out because it collides with code identifiers).
- R35, R36: `~` is not a path character at a directory boundary, and each directory entry is also matched in percent-encoded form (a located finding with no fix).
- R38, R43, R45, R46: a `cli-credentials` rule for `curl -u user:pass`, `sshpass -p`, `--password`-style flags, `mysql -p<pass>`, `aws configure set` and registry logins (docker, podman, helm, skopeo, nerdctl, buildah, oras, crane, regctl; `-p pass`, attached `-p<pass>`, `--password pass`, a backslash-continued command; `--password-stdin` stays clean); R39: a `webhook-url` rule for Slack, Discord and Teams webhook URLs.

- R44: Vault service, batch and recovery tokens (`hvs.`, `hvb.`, `hvr.`) are matched; the legacy `s.` form is not, because it collides with code identifiers such as `s.handlerName`. Cost if wrong: a legacy token without a keyword passes. R45: a registry-login password may be attached to the flag (`-p<pass>`, optionally quoted). Cost if wrong: an attached flag in an unlisted tool passes. R46: a login command may continue across lines with a backslash, and the same rule covers nerdctl, buildah, oras, crane and regctl. Cost if wrong: a password flag on a later line without a backslash passes; the `-p` of an unrelated command in the same note is refused only when it follows a login within 100 characters.

The stated boundary of the scanner, accepted by the owner on 2026-11-25 in `docs/accepted-boundaries.md`: it is a best-effort structural heuristic that intercepts standard forms of secrets (private-key blocks, known key prefixes, authorization headers, URL userinfo, keyword assignments, the CLI and webhook forms above); it does not detect an unanchored high-entropy value, a proprietary token with no known prefix, or a credential in a positional argument of a tool it has no rule for. Outbound safety also rests on the policy default of deny, on the human's confirmation wherever the mode is not allow (8.4, 8.5), and on the service's second scan, which rejects a hit after the secret has left the machine (8.7).

## Self-review (run 2026-11-25)

- **Spec coverage.** 7.1 default-ignorable: Task 1. 7.2, 7.3 envelope and rendered summaries: Task 5. 7.4 tags: Task 2. 8.1 scanner: Task 3. 8.4 policy file, scoped rules, veto, retraction exception: Task 4. 12.4 rule 4 installed version: Task 6. 12.3 invalid version has no row: Task 7. Not in 2a by design, and where they go: the draft lock (8.2), the local store (9.6), the veto file reading, the read record, lookup and send over local notes, the printed allow command, the command surface (2b); setup, uninstall, the always-on rule, dogfood (2c); the read-state rules of 8.3, the confirmation (8.5), the gate (9.2): plan 5.
- **Step scan.** Tasks 2 to 6 fix patterns, tables and formats that the implementer cannot decide alone, and leave bodies to the implementer. Task 3's `scanOutgoing` and Task 6's grammars are the two places where the rules, not the code, are the content.
- **Type consistency.** `WarningTag` and `WARNING_TAGS` from `limits.ts` are used by Tasks 2 and 5 unchanged. `Result` is `{ok:true,value}|{ok:false,error}` everywhere. Task 5 renders `Entry` and `Mark` as plan 1 defines them; Task 6 passes `recorded: string[]` to `resolveInstalled` as it is declared.
- **Open for the review of this plan:** the tag patterns and the secret patterns are a starting rule set, and the reviewer is invited to attack them with real, plausible agent notes; offsets in Task 3 are UTF-16 code units, not bytes, a deliberate difference from term 2's wording.
