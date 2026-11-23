# Project tasks. Run `just` to list them.

# Run recipe lines with bash in strict mode. `pipefail` matters for `secrets`:
# without it a failing `git log` piped into gitleaks would be reported as clean.
set shell := ["bash", "-euo", "pipefail", "-c"]

# List available recipes
default:
    @just --list

# Install dependencies and git hooks (needs bun and gitleaks on PATH; see README).
# lefthook is a dev dependency, so it is run from node_modules.
setup:
    @for tool in bun gitleaks; do command -v "$tool" >/dev/null || { echo "$tool is not installed; see README.md (Development)" >&2; exit 1; }; done
    bun install
    bun run --bun lefthook install

# Type-check with tsc (Bun does not type-check when it runs code).
# `bun run --bun` runs the installed binary on Bun, not Node, and unlike `bunx` never
# downloads a missing package. Run `just setup` first: without node_modules it falls
# back to a `tsc` or `biome` found on PATH.
typecheck:
    bun run --bun tsc --noEmit

# Lint and check formatting with Biome
lint:
    bun run --bun biome check .

# Apply Biome formatting and safe lint fixes
fmt:
    bun run --bun biome check --write .

# Run every test except the toolchain suite, which is slow and only matters
# when a tooling file changes
test:
    bun test --path-ignore-patterns='tests/toolchain/**'

# Run the toolchain suite: proves each gate in this file, the hooks and the
# config blocks what it should
test-toolchain:
    bun test tests/toolchain

# Scan for secrets: staged changes, the history of the current commit (patches,
# then commit messages), and unstaged changes to tracked files. Untracked files
# are scanned once they are staged. Only the current commit's history is
# scanned, not other branches or stashes, so the result describes what is
# checked out. `-m` makes git show merge commits as patches; without it,
# content added in a merge commit is never scanned. The diff filter skips
# deletions and unmerged, unknown and broken entries.
secrets: secrets-staged
    gitleaks git --log-opts="--full-history -m --diff-filter=uxdb" --no-banner --redact .
    git log --full-history --format=%B | gitleaks stdin --no-banner --redact
    gitleaks git --pre-commit --no-banner --redact .

# Scan only staged changes for secrets (used by the pre-commit hook)
secrets-staged:
    gitleaks git --staged --no-banner --redact .

# Scan the commit message file for secrets (used by the commit-msg hook).
# The path arrives in HOOK_ARG_1, exported by .lefthook/rc.sh, never as text
# pasted into a command: a path containing shell syntax is then not run.
# Without it there is nothing to scan, so the recipe fails rather than passes.
# It also fails when rc.sh is missing: lefthook skips a missing rc file
# silently, and HOOK_ARG_1 could then be a stale value from the caller's
# environment rather than the file git is about to commit.
secrets-message:
    @test -f .lefthook/rc.sh || { echo "secrets-message: .lefthook/rc.sh is missing, so the message file cannot be identified" >&2; exit 1; }
    @test -n "${HOOK_ARG_1:-}" || { echo "secrets-message: HOOK_ARG_1 is not set; this recipe runs from the commit-msg hook" >&2; exit 1; }
    gitleaks stdin --no-banner --redact < "$HOOK_ARG_1"

# The fast gate: what the pre-push hook always runs
check-fast: typecheck lint test secrets

# The full gate: everything CI runs
check: check-fast test-toolchain
