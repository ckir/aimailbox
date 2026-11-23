# AGY-CAPSTONE ledger

One row per completed capstone review: an adversarial review of committed code by the agy
peer, with every finding measured by the driver before it was fixed. The range's right-hand
commit is the one that was reviewed and confirmed.

| Date       | Range                                 | Rounds | Verdict                               | Evidence                                                                                             |
| ---------- | ------------------------------------- | ------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 2026-11-23 | 1832d1e..8233938 (toolchain scaffold) | 5      | ALIGNED, GREEN confirmed by the owner | Fold commits 78bbe87, e5fc0ff, d814313, 69148e5, 8233938. Round 5 was clean and narrowed to 8233938. |

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
