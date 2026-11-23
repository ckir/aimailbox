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

- Configure hooks in the root `lefthook.yml`; install them with `lefthook install`.
- Hooks should call `just` recipes where one exists, so checks run the same way locally and in hooks.

## Type checking

Bun strips types without checking them, so type errors only surface through `tsc`.

- Run `just typecheck` (`tsc --noEmit`, settings in `tsconfig.json`).

## Lint and format

Use [Biome](https://biomejs.dev) for linting and formatting, not ESLint or Prettier.

- `just lint` checks, `just fmt` fixes. Settings are in `biome.json`.

## Secret scanning

Use [gitleaks](https://github.com/gitleaks/gitleaks) to keep secrets out of this public repo.

- `just secrets` scans the full history (including merge commits) plus staged and unstaged changes to tracked files; the pre-commit hook scans staged changes.
- gitleaks is a standalone binary, not a dev dependency. Install it before committing: the hook fails if it is missing.

## Checks and CI

- `just setup` installs dependencies and git hooks on a fresh clone.
- `just check` runs typecheck, lint, tests and the secret scan. Run it before declaring work done.
- pre-commit runs Biome on staged files, the type check and the staged secret scan; pre-push runs `just check`.
- GitHub Actions (`.github/workflows/ci.yml`) runs `just check` on pushes to `main` and on pull requests. Add new checks as `just` recipes under `check` so hooks and CI pick them up.
- CI is the authoritative gate. The hooks are fast local feedback: they check the working tree, not the exact commit, so uncommitted or unstaged files can hide a problem in what is committed or pushed, and `--no-verify` skips them. Do not treat a passing hook as proof a commit is clean; commit or stash first and run `just check` when it matters.
- `gitleaks:allow` comments are honoured, as the way to mark a false positive. Use them only for values that are not secrets.
