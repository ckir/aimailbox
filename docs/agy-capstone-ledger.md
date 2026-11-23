# AGY-CAPSTONE ledger

One row per completed capstone review: an adversarial review of committed code by the agy
peer, with every finding measured by the driver before it was fixed. The range's right-hand
commit is the one that was reviewed and confirmed.

| Date       | Range                                                                    | Rounds | Verdict                               | Evidence                                                                                                                               |
| ---------- | ------------------------------------------------------------------------ | ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-23 | 1832d1e..8233938 (toolchain scaffold)                                    | 5      | ALIGNED, GREEN confirmed by the owner | Fold commits 78bbe87, e5fc0ff, d814313, 69148e5, 8233938. Round 5 was clean and narrowed to 8233938.                                   |
| 2026-11-23 | 54cfa2a..b060561 (toolchain tests and their placement)                   | 5      | ALIGNED, GREEN confirmed by the owner | Fold commits bcb9065, 941ddee, 5dbe7c7, b060561; placement commit 2363944. Round 5 was clean and narrowed to b060561.                  |
| 2026-11-23 | 8248cb5..b7020c6 (second-audit tests)                                    | 2      | ALIGNED, GREEN confirmed by the owner | Fold commit b7020c6; docs-only follow-up 9e22619. Round 2 found no defect in the test code.                                            |
| 2026-11-23 | f78d7d8..4034060 (CODEOWNERS, SHA pins, commit-msg hook, local lefthook) | 4      | ALIGNED, GREEN confirmed by the owner | Fold commits 4f31e38, f3b6a52, 4034060 on top of 8dda991. Rounds 3 and 4 were clean.                                                   |
| 2026-11-23 | cd68f70..eb72824 (message-file check, wider CODEOWNERS)                  | 2      | ALIGNED, GREEN confirmed by the owner | Fold commit eb72824 on top of f8e716f; comment-only follow-up c506136. Round 2 found no runtime defect.                                |
| 2026-11-23 | eb72824..2864a53 (third-audit tests)                                     | 2      | ALIGNED, GREEN confirmed by the owner | Fold commit 2864a53 on top of 4ef8467 and bd49af6. Round 2 was clean.                                                                  |
| 2026-11-23 | 2864a53..e663346 (four more CODEOWNERS entries)                          | 0      | WAIVED by the owner, no review run    | Commit e663346: four CODEOWNERS lines and the matching test entries; removing any one entry fails two tests.                           |
| 2026-11-23 | 49cd040..4b444fa (fake token generator without modulo)                   | 0      | WAIVED by the owner, no review run    | Commit 4b444fa: fixes CodeQL alert js/biased-cryptographic-random in tests/toolchain/helpers.ts; CI and CodeQL pass on pull request 5. |

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

## Notes for the 2026-11-23 review of the hardening changes

- Findings: 7 across rounds 1 and 2, all reproduced. lefthook pastes hook arguments into
  shell commands unescaped, so the first commit-msg hook could run a command hidden in a
  directory name; two attempts at quoting failed under test. After a design consult the owner
  chose to carry the path in an environment variable exported by `.lefthook/rc.sh`.
  `bun run --bun lefthook` fell back to a lefthook on PATH, so the pin is now by path.
- Round 3 was clean; one case the peer set aside (rc.sh missing plus a preset variable) was
  reproduced and closed before round 4, which was also clean.
- Not covered by the clean rounds: rounds 3 and 4 were narrowed to one commit each; CODEOWNERS
  enforcement depends on branch protection, which is not set; not tested on macOS or Windows.

## Notes for the message-file check review (cd68f70..eb72824)

- Findings: 2 across rounds 1 and 2. Round 1: with `CDPATH` exported, the directory comparison
  refused a message file given by absolute path (fixed in eb72824, which also refuses a
  symbolic link). Round 2: the driver overstated that bug's impact; an ordinary `git commit`
  was never affected. The test comment is corrected in c506136; the commit message of eb72824
  still carries the overstatement.
- Not covered by the clean round: round 2 was narrowed to eb72824; c506136 (a comment) was not
  reviewed; not tested on macOS or Windows.
- Known and accepted: `JUST_DRY_RUN=true` or an exported shell function named `cd` in the
  developer's own shell can defeat the local commit-msg check; CI is unaffected.
- Not added: `package.json`, `bun.lock`, `biome.json` and `tsconfig.json` are outside
  CODEOWNERS; the owner chose the list of owned paths.

## Notes for the review of the third-audit tests (eb72824..2864a53)

- Findings: 4 in round 1, all reproduced and fixed in 2864a53 (test code only): the
  CODEOWNERS matcher did not let `**/` match zero directories; a workflow-level or job-level
  default shell, `set +o errexit` and `set +xe`, and a job `container` or `services` image
  were not checked. Nine mutants go red. Round 2 found nothing.
- Not covered by the clean round: round 2 was narrowed to 2864a53; not tested on macOS or
  Windows.
- Discarded below the floor: `set -x +e` would pass the script check (no CI script uses
  `set`); the matcher treats `/dir/*` as covering nested files, which only makes the test
  stricter than GitHub.
- Known: the commit message of 4ef8467 said the job had no custom shell when only the steps
  were checked; 2864a53 closes it. The check that no CI script contains `||` is deliberately
  blunt and fails closed.
