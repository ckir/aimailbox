# AGY-TEST-AUDIT ledger

One row per completed test audit: a review by the agy peer of whether the committed tests
would catch the next regression, with every claimed gap verified by a mutant before it was
accepted. The range's right-hand commit is the last one the audit covered. This is a record,
not a proof.

Conventions: the newest row goes at the bottom, and a `|` inside a cell is written `\|`.

| Date       | Range                                                                         | Rounds | Verdict                 | Evidence                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------- | ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-23 | 1832d1e..ea937b3 (toolchain scaffold and its tests)                           | 2      | GAPS FOUND, all closed  | Fold commits 8becf24, ab9abf0, ea937b3. Briefs: .clavity/seams/toolchain-scaffold-test-audit.md and -test-audit-r2.md.                      |
| 2026-11-23 | ea937b3..2864a53 (CODEOWNERS, SHA pins, commit-msg hook, pinned lefthook)     | 1      | GAPS FOUND, all closed  | Fold commits 4ef8467, bd49af6, 2864a53. Brief: .clavity/seams/toolchain-scaffold-test-audit-r3.md.                                          |
| 2026-11-24 | 22c1d0a..65516d8 (mailbox core, plan 1: unit and property tests)              | 2      | GAPS FOUND, all closed  | Fold commit 65516d8. Briefs: .clavity/seams/agent-mailbox-core-test-audit.md and -test-audit-r2.md.                                         |
| 2026-11-25 | 77f7fb7..26fb04f (mailbox core logic, plan 2a: eight modules and their tests) | 1      | GAPS FOUND, all refuted | The peer's three gaps each failed a logic mutant; no gap verified, no test added. Brief: .clavity/seams/agent-mailbox-plan2a-test-audit.md. |

## Notes for the 2026-11-23 audit

- Round 1 found five gaps: nothing committed failed when the secret scan, the hook hardening,
  the strictness settings, the strict shell or the setup guard was weakened. The owner scoped
  all five; they were closed by adding `tests/toolchain/`.
- Round 2 found seven gaps in that suite: the CI workflow, `just setup` installing the hooks,
  type-check coverage of `tests/`, pre-commit staging of fixes, pre-commit on commits with no
  file Biome checks, three more TypeScript options, and two Biome settings. The owner scoped
  all seven; they were closed with test code, plus one line of `CLAUDE.md`.
- Every gap was verified first by a mutant that left the suite green, and for every gap at
  least one of its new tests was then shown to fail under that mutant. Tests that only assert
  a clean project passes, and some of the CI workflow assertions, were not mutated one by one.
- Discarded below the floor: `just fmt` has no test (a convenience recipe; `just lint` is the
  gate); static `package.json` fields have no test (no logic).
- Not examined: the suite on Windows or with git older than 2.32; behaviour of the pinned
  GitHub Actions themselves. The audit raises the floor; it does not prove no gap remains.
- Accepted boundaries are listed in `docs/accepted-boundaries.md`.

## Notes for the third audit (ea937b3..2864a53)

- Gaps: 8, each confirmed by applying the change and seeing every committed test stay green;
  the owner scoped all eight. Closed with test code only: `bun install` in `just setup`; a
  later CODEOWNERS rule overriding a protected entry; `continue-on-error`, job permissions
  and a swallowed failure in the CI workflow; the resolved-directory comparison in
  `secrets-message`; the exact lefthook pin; the commit-msg scan on `git merge`. Ten mutants
  go red, each on the new test written for it.
- Two more, named in the peer's full analysis and scoped in by the owner (bd49af6): a tracked
  `lefthook-local.yml` (measured: `commit-msg: skip: true` there turns the scan off) and a
  second workflow file outside the checks on `ci.yml`. Three more mutants go red.
- The new tests then went through a capstone review, which tightened three of them in
  2864a53 (see `docs/agy-capstone-ledger.md`).
- Discarded below the floor: removing `--redact` from `secrets-message` (gitleaks does not
  print the secret without `-v`, measured); removing `bun` from the `setup` tool guard (the next line
  fails anyway); removing `--` from `cd --` (only matters for a git directory whose relative
  path starts with a hyphen).
- Not examined: Windows and macOS; the audit was one round and was not re-run on the new
  tests. The audit raises the floor; it does not prove no gap remains.

## Notes for the 2026-11-24 audit of the mailbox core

- Round 1 (the 13 unit-test files) claimed four gaps; measured by logic mutants in a copy of
  `src/core`. Closed with test code only, in `65516d8`: a question marked resolved for a version
  was untested by `markEntry` (a mutant survived all 208 tests); a digest page read from the wire
  was never fed into a lookup (a mutant dropping a question's version in `readDigestPage` survived);
  one lookup test counted what it listed instead of naming it. Refuted: that `order.test.ts` never
  ranks questions or replies (five mutants of `orderKeys` were all killed by existing tests).
- Round 2 (the property tests and the round 1 fixes) claimed four gaps; all four refuted. The mutants
  that agy said survived the 47 property tests (an installed version of `undefined` or older still
  resolving; reversed drop order of unorderable rows; mark ranks 3 and 4 never generated) are each
  killed by a named unit test, and ten mutants of `address.ts` are all killed, among them the
  fixed-point tests over a grammar in `address-go-tool.test.ts`.
- No source file changed, so the capstone of the range still stands.
- Discarded below the floor: `status.test.ts` does not pin `s.rows[15]` (a property test does);
  `ecosystemOf` is not asserted for cargo, pypi and tool (it is unreachable except through
  `isCanonical`).
- Not examined: the Unicode version of the Bun runtime against the folded tables; storage, HTTP and
  file-system behaviour (plans 2 to 5). The audit raises the floor; it does not prove no gap remains.

## Notes for the 2026-11-25 audit of plan 2a (77f7fb7..26fb04f)

- The capstone of this range ended in an owner waiver after seven rounds (see
  `docs/agy-capstone-ledger.md`), not in a clean GREEN. The brief said so, and told the peer not to
  ask for a test that pins a scanner behaviour with a live finding. The peer asked for none.
- One round, three claimed gaps, all REFUTED by logic mutants in a copy of `src/core` outside the
  repository. Gap 1 (`highestConfirmed` untested for cargo and go): disabling it for cargo, for go or
  for npm each fails `status.test.ts` (disabling it for pypi survives because pypi has no orderable
  version, so the function already returns nothing there). Gap 2 (`VOTE_VERSIONS` has no invalid
  version, so deleting the validity filter in `tallyRows` goes unseen): the mutant fails two
  `status.test.ts` tests, `a vote whose version is invalid as written makes no row, in either vote
  order` and `an invalid-version vote still counts in the totals`. Gap 3 (cargo and go sorting and
  row truncation only exercised under npm): reversing the version sort or switching truncation off
  for cargo, for go or for both fails `a smaller row limit keeps unchanged rows...` and, for the sort,
  `rows list orderable versions oldest first...`, each in `status.test.ts` itself.
- Of the driver's four guesses the peer called guesses 3 and 4 wrong, guess 1 partly wrong and guess
  2 right. Guess 2 (no invalid version in `VOTE_VERSIONS`) is true of the generator, but the unit
  tests in `status.test.ts` cover it, so it is not a gap.
- Discarded below the floor, and checked: a rendered prefix longer than `summaryLineBytes` cannot
  occur (`versionChars` is 64, the line cap is 1024); an empty segment in a rule directory cannot
  occur (`readDirectory` rejects it, `policy.ts`).
- The peer's open question 3 suggests a committed corpus (secrets that must be refused, ordinary notes
  that must stay clean) as the scanner's safety net instead of per-rule examples. It is a design
  suggestion, not a gap, and is not adopted here; it is left to the owner.
- The peer's mutants were stated as measured and were not: its evidence fields cannot be trusted
  for this suite. A zero-gap result from one peer raises the floor little; it does not prove no
  gap remains.
- Not examined: the scanner's pattern coverage (the accepted boundary in `docs/accepted-boundaries.md`);
  storage, HTTP and file-system behaviour (plans 2b to 5).
