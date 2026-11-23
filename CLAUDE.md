# aimailbox

## Runtime and toolchain

Use [Bun](https://bun.sh) for TypeScript in this repo, not Node.js.

- Run code with `bun run <file>.ts` (not `node`, `ts-node` or `tsx`).
- Manage packages with `bun install` / `bun add` and run binaries with `bunx` (not npm, yarn, pnpm or `npx`).
- Run tests with `bun test`.
- Prefer Bun-native APIs (`Bun.serve`, `Bun.file`, `bun:sqlite`, `bun:test`) and `@types/bun` over Node-specific equivalents.

## Task runner

Use [just](https://just.systems) for project tasks, not npm scripts or Makefiles.

- Define recipes in the root `justfile` and run them with `just <recipe>`.
- Recipes call Bun (`bun run`, `bun test`, `bunx`), not Node tooling.

## Git hooks

Use [lefthook](https://lefthook.dev) for git hooks, not husky, pre-commit or hand-written `.git/hooks` scripts.

- lefthook is a dev dependency pinned in `package.json`, not a machine-level tool. Run it as `bun run --bun lefthook <command>`.
- Configure hooks in the root `lefthook.yml`; `just setup` installs them.
- Hooks should call `just` recipes where one exists, so checks run the same way locally and in hooks.
- Three hooks are installed: pre-commit, commit-msg and pre-push.
- `lefthook.yml` sets `lefthook: bun ./node_modules/.bin/lefthook`, so the installed hooks run the copy pinned in `package.json` and never a `lefthook` on `PATH`. A clone or worktree without `node_modules`, or a git client whose `PATH` has no `bun`, cannot commit or push until that is fixed: the hooks fail rather than skip.
- The commit-msg hook gets the message file's path through the environment variable `HOOK_ARG_1`, exported by `.lefthook/rc.sh`, not as a command argument. lefthook pastes hook arguments into shell commands unescaped, so a path with shell syntax in it would be run: do not use `{0}`, `{1}` and so on in `lefthook.yml`. `just secrets-message` only works from the installed hook, and only on a regular file inside the git directory, which is where git keeps commit message files.
- `bun install` also installs the hooks, because Bun trusts the `lefthook` package's install script by default (it does nothing when `CI=true`). `just setup` still runs the install explicitly.

## Type checking

Bun strips types without checking them, so type errors only surface through `tsc`.

- Run `just typecheck` (`tsc --noEmit`, settings in `tsconfig.json`).

## Lint and format

Use [Biome](https://biomejs.dev) for linting and formatting, not ESLint or Prettier.

- `just lint` checks, `just fmt` fixes. Settings are in `biome.json`.

## Secret scanning

Use [gitleaks](https://github.com/gitleaks/gitleaks) to keep secrets out of this public repo.

- `just secrets` scans the history of the current commit (patches, merge commits and commit messages) plus staged and unstaged changes to tracked files; the pre-commit hook scans staged changes. Other branches and stashes are not scanned.
- gitleaks is a standalone binary, not a dev dependency. Install it before committing: the hook fails if it is missing.

## Tests

- `just test` runs every test except the toolchain suite. Product tests live next to the code in `src/`. `tests/gate/` holds fast tests that read the CI workflow, CODEOWNERS and the list of tracked config files; they run here, and so in `check-fast`, so that a change to the workflow cannot skip them. A bare `bun test` runs everything, toolchain suite included.
- `just test-toolchain` runs `tests/toolchain/`, which tests the tooling itself: each test builds a throwaway git repository with a copy of the justfile, hook and config files plus a fixed two-file fixture, and proves a gate blocks what it should (a secret in each place the scan looks, a type error, a lint error, hostile file names and remote URLs). It takes about 30 seconds.
- When you change `justfile`, `lefthook.yml`, `.lefthook/`, `tsconfig.json` or `biome.json`, run `just test-toolchain`. If you add or loosen a gate, add or update a test there, and check the test fails when the gate is removed.
- The suite copies the files listed in `TOOLCHAIN_FILES` (`tests/toolchain/helpers.ts`). A new config file that a tool reads automatically (for example `.gitleaks.toml` or `bunfig.toml`) is not covered until it is added there and to the `toolchain-tests` glob in `lefthook.yml`.
- Test secrets are generated at run time (`fakeToken()` in `tests/toolchain/helpers.ts`). Never commit a token-shaped literal, even a fake one: the secret scan will reject it.

## Checks and CI

- `just setup` installs dependencies and git hooks on a fresh clone.
- `just check` is the full gate: `check-fast` (typecheck, lint, `just test`, secret scan) plus `just test-toolchain`. Run it before declaring work done. `just check-fast` is the quick version for the inner loop.
- pre-commit runs Biome on staged files, the type check and the staged secret scan. commit-msg scans the commit message for secrets before the commit is created. pre-push always runs `just check-fast`, and also runs `just test-toolchain` when the push touches a file that suite tests.
- GitHub Actions (`.github/workflows/ci.yml`) runs `just check` on pushes to `main` and on pull requests. Add a new check as a `just` recipe under `check-fast` so the hook and CI both pick it up; a recipe added only under `check` runs in CI but not on push.
- The workflow pins each action to a full commit SHA, with the version in a trailing comment. To update one, look up the commit a release tag points at and change both. `.github/CODEOWNERS` routes changes to the workflow, `justfile`, `lefthook.yml`, `.lefthook/`, `package.json`, `bun.lock`, `biome.json`, `tsconfig.json`, `tests/gate/` and `tests/toolchain/` to the owner; it only has effect with branch protection requiring Code Owner review.
- CI is the authoritative gate. The hooks are fast local feedback: they check the working tree, not the exact commit, so uncommitted or unstaged files can hide a problem in what is committed or pushed, and `--no-verify` skips them. Do not treat a passing hook as proof a commit is clean; commit or stash first and run `just check` when it matters.
- `gitleaks:allow` comments are honoured, as the way to mark a false positive. Use them only for values that are not secrets.
