# Project tasks. Run `just` to list them.

# List available recipes
default:
    @just --list

# Install dependencies and git hooks (needs bun, lefthook and gitleaks on PATH; see README)
setup:
    @for tool in bun lefthook gitleaks; do command -v "$tool" >/dev/null || { echo "$tool is not installed; see README.md (Development)" >&2; exit 1; }; done
    bun install
    lefthook install

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

# Run the test suite
test:
    bun test

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

# Everything CI runs
check: typecheck lint test secrets
