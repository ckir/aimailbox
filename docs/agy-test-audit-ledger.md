# AGY-TEST-AUDIT ledger

One row per completed test audit: a review by the agy peer of whether the committed tests
would catch the next regression, with every claimed gap verified by a mutant before it was
accepted. The range's right-hand commit is the last one the audit covered. This is a record,
not a proof.

Conventions: the newest row goes at the bottom, and a `|` inside a cell is written `\|`.

| Date       | Range                                                                     | Rounds | Verdict                | Evidence                                                                                                               |
| ---------- | ------------------------------------------------------------------------- | ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-11-23 | 1832d1e..ea937b3 (toolchain scaffold and its tests)                       | 2      | GAPS FOUND, all closed | Fold commits 8becf24, ab9abf0, ea937b3. Briefs: .clavity/seams/toolchain-scaffold-test-audit.md and -test-audit-r2.md. |
| 2026-11-23 | ea937b3..bd49af6 (CODEOWNERS, SHA pins, commit-msg hook, pinned lefthook) | 1      | GAPS FOUND, all closed | Fold commits 4ef8467, bd49af6. Brief: .clavity/seams/toolchain-scaffold-test-audit-r3.md.                              |

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

## Notes for the third audit (ea937b3..bd49af6)

- Gaps: 8, each confirmed by applying the change and seeing every committed test stay green;
  the owner scoped all eight. Closed with test code only: `bun install` in `just setup`; a
  later CODEOWNERS rule overriding a protected entry; `continue-on-error`, job permissions
  and a swallowed failure in the CI workflow; the resolved-directory comparison in
  `secrets-message`; the exact lefthook pin; the commit-msg scan on `git merge`. Ten mutants
  go red, each on the new test written for it.
- Two more, named in the peer's full analysis and scoped in by the owner (bd49af6): a tracked
  `lefthook-local.yml` (measured: `commit-msg: skip: true` there turns the scan off) and a
  second workflow file outside the checks on `ci.yml`. Three more mutants go red.
- Discarded below the floor: removing `--redact` from `secrets-message` (gitleaks does not
  print the secret without `-v`, measured); removing `bun` from the `setup` tool guard (the next line
  fails anyway); removing `--` from `cd --` (only matters for a git directory whose relative
  path starts with a hyphen).
- Not examined: Windows and macOS; the audit was one round and was not re-run on the new
  tests. The audit raises the floor; it does not prove no gap remains.
