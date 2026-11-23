/**
 * Proves `just secrets` finds a secret in every place it claims to look, and
 * leaves alone the places it is meant to ignore. Each case pins one part of
 * the recipe: remove that part and the matching test fails.
 */
import { afterAll, expect, test } from "bun:test";
import { cpSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	cleanEnv,
	cleanup,
	commitAll,
	fakeToken,
	LEAK,
	makeDir,
	makeRepo,
	must,
	repoRoot,
	run,
	SLOW,
} from "./helpers.ts";

afterAll(cleanup);

const secretLine = () => `export const token = "${fakeToken()}";\n`;

test.concurrent(
	"just secrets passes on a clean repository",
	async () => {
		const repo = await makeRepo();
		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).not.toContain(LEAK);
		expect(result.exitCode).toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets fails on a secret in an ordinary commit",
	async () => {
		const repo = await makeRepo();
		writeFileSync(join(repo, "src/leak.ts"), secretLine());
		await commitAll(repo, "add a file");
		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets fails on a staged secret",
	async () => {
		const repo = await makeRepo();
		writeFileSync(join(repo, "src/leak.ts"), secretLine());
		await must(repo, ["git", "add", "src/leak.ts"]);
		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets fails on an unstaged secret in a tracked file",
	async () => {
		const repo = await makeRepo();
		writeFileSync(join(repo, "src/index.ts"), secretLine(), { flag: "a" });
		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets fails on a secret added in a merge commit",
	async () => {
		// Git shows no patch for a merge commit unless asked (`-m`), so a secret
		// introduced while merging is invisible to a default history scan.
		const repo = await makeRepo();
		await must(repo, ["git", "switch", "--quiet", "--create", "side"]);
		writeFileSync(join(repo, "side.txt"), "side\n");
		await commitAll(repo, "side change");
		await must(repo, ["git", "switch", "--quiet", "main"]);
		writeFileSync(join(repo, "main.txt"), "main\n");
		await commitAll(repo, "main change");
		await must(repo, [
			"git",
			"merge",
			"--quiet",
			"--no-commit",
			"--no-ff",
			"side",
		]);
		writeFileSync(join(repo, "src/leak.ts"), secretLine());
		await commitAll(repo, "merge side");
		const parents = await must(repo, ["git", "log", "-1", "--format=%P"]);
		expect(parents.output.trim().split(" ")).toHaveLength(2);

		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets fails on a secret in a commit message",
	async () => {
		const repo = await makeRepo();
		await must(repo, [
			"git",
			"commit",
			"--quiet",
			"--no-verify",
			"--allow-empty",
			"-m",
			`deploy with ${fakeToken()}`,
		]);
		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets fails on a secret in a file that replaced a symlink",
	async () => {
		// Git records this as a type change, which gitleaks' default history
		// options filter out.
		const repo = await makeRepo();
		symlinkSync("package.json", join(repo, "config-link"));
		await commitAll(repo, "add a link");
		rmSync(join(repo, "config-link"));
		writeFileSync(join(repo, "config-link"), `token = "${fakeToken()}"\n`);
		await commitAll(repo, "replace the link with a file");
		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets ignores secrets on another branch and in a stash",
	async () => {
		// Only the history of the checked-out commit is scanned, so a problem
		// elsewhere cannot fail a clean change.
		const repo = await makeRepo();
		await must(repo, ["git", "switch", "--quiet", "--create", "dirty"]);
		writeFileSync(join(repo, "src/leak.ts"), secretLine());
		await commitAll(repo, "leak on another branch");
		await must(repo, ["git", "switch", "--quiet", "main"]);
		writeFileSync(join(repo, "src/index.ts"), secretLine(), { flag: "a" });
		await must(repo, ["git", "stash", "--quiet"]);

		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).not.toContain(LEAK);
		expect(result.exitCode).toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets fails when git log fails, rather than reporting a clean scan",
	async () => {
		// A directory that is not a git repository: `git log` exits 128 while
		// gitleaks, reading an empty stream, exits 0. Only `pipefail` in the
		// justfile's shell setting turns that into a failure.
		const dir = makeDir();
		cpSync(join(repoRoot, "justfile"), join(dir, "justfile"));
		const result = await run(
			dir,
			["just", "secrets"],
			cleanEnv({ GIT_CEILING_DIRECTORIES: dir }),
		);
		expect(result.output).toContain("not a git repository");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);
