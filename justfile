# Project tasks. Run `just` to list them.

# List available recipes
default:
    @just --list

# Install dependencies and git hooks
setup:
    bun install
    lefthook install

# Type-check with tsc (Bun does not type-check when it runs code).
# `bun run --bun` uses only the locally installed binary and runs it on Bun, not Node.
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

# Scan the whole git history for secrets
secrets:
    gitleaks git --no-banner --redact .

# Scan only staged changes for secrets (used by the pre-commit hook)
secrets-staged:
    gitleaks git --staged --no-banner --redact .

# Everything CI runs
check: typecheck lint test secrets
