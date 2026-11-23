# AGY-TEST-AUDIT ledger

One row per completed test audit: a review by the agy peer of whether the committed tests
would catch the next regression, with every claimed gap verified by a mutant before it was
accepted. The range's right-hand commit is the last one the audit covered. This is a record,
not a proof.

Conventions: the newest row goes at the bottom, and a `|` inside a cell is written `\|`.

| Date       | Range                                               | Rounds | Verdict                | Evidence                                                                                                               |
| ---------- | --------------------------------------------------- | ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-11-23 | 1832d1e..ea937b3 (toolchain scaffold and its tests) | 2      | GAPS FOUND, all closed | Fold commits 8becf24, ab9abf0, ea937b3. Briefs: .clavity/seams/toolchain-scaffold-test-audit.md and -test-audit-r2.md. |

## Notes for the 2026-11-23 audit

- Round 1 found five gaps: nothing committed failed when the secret scan, the hook hardening,
  the strictness settings, the strict shell or the setup guard was weakened. The owner scoped
  all five; they were closed by adding `tests/toolchain/`.
- Round 2 found seven gaps in that suite: the CI workflow, `just setup` installing the hooks,
  type-check coverage of `tests/`, pre-commit staging of fixes, pre-commit on commits with no
  file Biome checks, three more TypeScript options, and two Biome settings. The owner scoped
  all seven; they were closed with test code only.
- Every gap was verified first by a mutant that left the suite green, and every new test was
  shown to fail under a mutant of the gate it pins.
- Discarded below the floor: `just fmt` has no test (a convenience recipe; `just lint` is the
  gate); static `package.json` fields have no test (no logic).
- Not examined: the suite on Windows or with git older than 2.32; behaviour of the pinned
  GitHub Actions themselves. The audit raises the floor; it does not prove no gap remains.
- Accepted boundaries are listed in `docs/accepted-boundaries.md`.
