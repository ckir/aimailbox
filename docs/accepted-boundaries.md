# Accepted boundaries

Behaviours the tests deliberately do not cover, each accepted by the owner, with what
compensates for it. A test audit does not re-raise these while the compensation still exists.
Remove an entry when it is closed.

## Secret scan

- **Binary files, annotated tag messages, submodule contents, and a secret split across
  several commits are not scanned.** Compensation: none in this repository; accepted as limits
  of the scan (owner, 2026-11-23). Anchor: `justfile`, recipe `secrets`.
- **`gitleaks:allow` comments are honoured.** Compensation: each use is visible in review
  (owner, 2026-11-23). Anchor: `justfile`, recipe `secrets`.
- **Further `git log` options that would narrow the history scan are not each tested.** The
  suite pins depth, merges, first parents, commit-message bodies, type changes and the first
  commit; the set of possible narrowing options is open-ended. Compensation: a change to the
  `secrets` recipe is a one-line diff in review (owner, 2026-11-23). Anchor:
  `tests/toolchain/secrets.test.ts`.

## Hooks

- **The local hooks check the working tree, not the exact commit, and can be skipped.**
  Compensation: CI runs `just check` on every pull request and push to `main` (owner,
  2026-11-23). Anchor: `.github/workflows/ci.yml`, step `Check`.
- **The conditional `toolchain-tests` pre-push job is skipped for a deletion-only tooling
  commit, for uncommitted tooling edits, and when pushing a ref other than the checked-out
  one.** Compensation: the same CI run (owner, 2026-11-23). Anchor: `lefthook.yml`, job
  `toolchain-tests`.

## Toolchain suite

- **A config file that a tool reads automatically is not covered until it is added to
  `TOOLCHAIN_FILES` and the hook's glob.** Compensation: documented in `CLAUDE.md`, section
  Tests (owner, 2026-11-23). Anchor: `tests/toolchain/helpers.ts`, `TOOLCHAIN_FILES`.
- **The CI workflow is checked by reading it, not by running it.** Compensation: it runs on
  every pull request. Anchor: `tests/toolchain/ci.test.ts`.
- **`src/index.ts` and `src/index.test.ts` are placeholders** with one trivial test.
  Compensation: none needed until product code exists (owner, 2026-11-23).
