# AGY-CAPSTONE ledger

One row per completed capstone review: an adversarial review of committed code by the agy
peer, with every finding measured by the driver before it was fixed. The range's right-hand
commit is the one that was reviewed and confirmed.

| Date       | Range                                                  | Rounds | Verdict                               | Evidence                                                                                                              |
| ---------- | ------------------------------------------------------ | ------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 2026-11-23 | 1832d1e..8233938 (toolchain scaffold)                  | 5      | ALIGNED, GREEN confirmed by the owner | Fold commits 78bbe87, e5fc0ff, d814313, 69148e5, 8233938. Round 5 was clean and narrowed to 8233938.                  |
| 2026-11-23 | 54cfa2a..b060561 (toolchain tests and their placement) | 5      | ALIGNED, GREEN confirmed by the owner | Fold commits bcb9065, 941ddee, 5dbe7c7, b060561; placement commit 2363944. Round 5 was clean and narrowed to b060561. |
| 2026-11-23 | 8248cb5..b7020c6 (second-audit tests)                  | 2      | ALIGNED, GREEN confirmed by the owner | Fold commit b7020c6; docs-only follow-up 9e22619. Round 2 found no defect in the test code.                           |

## Notes for the 2026-11-23 review

- Findings: 16 across rounds 1 to 4 and one design consult; 13 fixed, 3 settled by owner rulings.
- Owner rulings: the git hooks stay fast working-tree checks and CI is the authoritative gate;
  `gitleaks:allow` comments stay honoured; the secret scan's known limits are accepted (binary
  files, annotated tag messages, submodule contents, secrets split across commits).
- Discarded below the floor: untracked files that are never staged are not scanned (they
  cannot be committed without passing the staged scan); `just check` stops at the first
  failing recipe (no check is lost).
- Not covered by the clean round: CI had not yet run on GitHub; round 5 reviewed only the last
  commit; Windows was not tested.
- The design consult and rounds 2 to 5 ran in the same agy conversation (shared context).

## Notes for the 2026-11-23 review of the toolchain tests

- Findings: 15 across rounds 1 to 4; 12 fixed in the test code, 3 were wording errors by the
  driver in commit messages, a pull request description and a review brief.
- Owner rulings: where the toolchain suite runs was negotiated with the review peer and
  approved (full gate in `just check` and CI; fast gate on every push; the suite on push only
  when a tooling file changes).
- Round 5 asked only whether the test code is correct. Looking for further one-line
  weakenings of the recipes that survive the suite was handed to the test audit.
- Not covered by the clean round: the last two commits had not run in CI; the suite needs git
  2.32 or newer; all rounds ran in the same peer conversation (shared context).

## Notes for the 2026-11-23 review of the second-audit tests

- Findings: 5 across two rounds. Fixed: the CI workflow tests ran only in the toolchain suite,
  so a downgraded workflow passed its own CI (they now run in the fast gate); the download
  test did not check the pins were used; the setup test broke with wrapper-script tools; a
  stale path in `docs/accepted-boundaries.md`. One was inaccurate wording by the driver in the
  audit ledger, corrected there.
- Ran in a fresh peer conversation, separate from the earlier reviews.
- Not covered by the clean round: the docs-only commit 9e22619 was made after it; round 2 was
  narrowed to the fix commit; a pull request that weakens the workflow and edits its tests
  together is stopped only by review and branch protection.
