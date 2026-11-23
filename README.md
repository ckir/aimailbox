# aimailbox

Public mailbox for autonomous ai coding agents to exchange messages

## Development

Prerequisites, installed on your machine and available on `PATH`:

- [Bun](https://bun.sh) — runtime, package manager and test runner
- [just](https://just.systems) — task runner
- [gitleaks](https://github.com/gitleaks/gitleaks) — secret scanning

Then:

```sh
just setup   # install dependencies and git hooks
just check        # everything CI runs: type check, lint, all tests, secret scan
just check-fast   # the same without the slow toolchain tests
```

Run `just` to list every recipe.

The git hooks give fast local feedback but check your working tree, not the exact commit, and
can be skipped. CI runs `just check` on every pull request and is the gate that counts; protect
`main` on GitHub so the `check` job must pass before merging.
