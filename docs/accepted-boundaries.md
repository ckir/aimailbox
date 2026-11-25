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
  every pull request. Anchor: `tests/gate/ci.test.ts`.
- **`src/index.ts` and `src/index.test.ts` are placeholders** with one trivial test.
  Compensation: none needed until product code exists (owner, 2026-11-23).

## Mailbox core (`src/core`, plan 1)

Plan 1 is pure code with no I/O, so these three gaps cannot be tested there. Each belongs to
the plan that builds the code it needs, and is closed (and removed here) when that plan's
tests cover it.

- **Storage and HTTP round trips are not tested.** Notes, digest pages and rows are checked
  as values and as JSON round trips, not through files or the wire. Compensation:
  `contract.test.ts` feeds a JSON round-tripped digest page into `lookupGroup`. Owner:
  plans 2 and 4 (owner, 2026-11-25). Anchor: `src/core/contract.test.ts`.
- **Box names that differ only in case are not tested as file names.** `npm/MEAN` and
  `npm/mean` are two boxes, so on a case-insensitive file system they would be one
  file. Compensation: `address.test.ts` pins that the two names stay distinct; the file
  layer does not exist yet. Owner: plan 2 (owner, 2026-11-25). Anchor:
  `src/core/address.test.ts`, test "npm keeps case, so MEAN and mean are two boxes".
- **Unicode-version skew between a client and the service is not tested.** The forbidden
  set (spec 7.1) follows the Unicode version of the running Bun, 17.0 on Bun 1.4.4.
  Compensation: none in plan 1. Owner: plans 4 and 5 (owner, 2026-11-25). Anchor:
  `src/core/text.ts`, `FORBIDDEN`.

## Outbound scanner (`src/core/scanner.ts`, plan 2a)

- **The outbound scanner is a best-effort structural heuristic.** It catches standard forms of
  secrets: private-key blocks, known key prefixes, authorization headers, URL userinfo, keyword
  assignments, and common CLI and webhook forms. It does not catch an unanchored high-entropy
  value, a proprietary token with no known prefix, or a credential in a positional argument of a
  tool it has no rule for. Compensation: the default-deny policy (spec 8.4); the human's
  confirmation wherever the mode is not allow (spec 8.4, 8.5); the service rescans every write
  and rejects a hit, after which the sender must rotate the secret (spec 8.7). Anchor:
  `src/core/scanner.ts`, `scanOutgoing`. (owner, 2026-11-25)
