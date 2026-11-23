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

/**
 * Put clean commits on top of whatever is at HEAD. A secret must be found
 * however far back it is, so the history cases bury theirs: a scan cut down
 * to the newest few commits would otherwise pass every test. Each commit
 * changes a file, because git leaves empty commits out when it counts
 * commits for a filtered log.
 */
async function bury(repo: string): Promise<void> {
	for (let depth = 1; depth <= 5; depth++) {
		writeFileSync(join(repo, `later-${depth}.txt`), `later work ${depth}\n`);
		await commitAll(repo, `later work ${depth}`);
	}
}

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
		await bury(repo);
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
		await bury(repo);

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
			// In the body, not the subject line: the whole message is scanned.
			`deploy the service\n\nUploads use ${fakeToken()} for now.`,
		]);
		await bury(repo);
		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets fails on a secret in a merge commit's message",
	async () => {
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
			"--no-ff",
			"--no-verify",
			"-m",
			`merge side, token ${fakeToken()}`,
			"side",
		]);
		const parents = await must(repo, ["git", "log", "-1", "--format=%P"]);
		expect(parents.output.trim().split(" ")).toHaveLength(2);
		await bury(repo);

		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets fails on a secret added and removed on a merged side branch",
	async () => {
		// The secret never appears in a first-parent commit of main or in the
		// merged result, only in the side branch's own history.
		const repo = await makeRepo();
		await must(repo, ["git", "switch", "--quiet", "--create", "side"]);
		writeFileSync(join(repo, "src/leak.ts"), secretLine());
		await commitAll(repo, "side: add a file");
		rmSync(join(repo, "src/leak.ts"));
		await commitAll(repo, "side: remove the file");
		await must(repo, ["git", "switch", "--quiet", "main"]);
		writeFileSync(join(repo, "main.txt"), "main\n");
		await commitAll(repo, "main change");
		await must(repo, [
			"git",
			"merge",
			"--quiet",
			"--no-ff",
			"--no-verify",
			"-m",
			"merge side",
			"side",
		]);
		await bury(repo);

		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets fails on a secret in a commit message on a merged side branch",
	async () => {
		const repo = await makeRepo();
		await must(repo, ["git", "switch", "--quiet", "--create", "side"]);
		writeFileSync(join(repo, "side.txt"), "side\n");
		await must(repo, ["git", "add", "--all"]);
		await must(repo, [
			"git",
			"commit",
			"--quiet",
			"--no-verify",
			"-m",
			`side change\n\nTested with ${fakeToken()}.`,
		]);
		await must(repo, ["git", "switch", "--quiet", "main"]);
		writeFileSync(join(repo, "main.txt"), "main\n");
		await commitAll(repo, "main change");
		await must(repo, [
			"git",
			"merge",
			"--quiet",
			"--no-ff",
			"--no-verify",
			"-m",
			"merge side",
			"side",
		]);
		await bury(repo);

		const result = await run(repo, ["just", "secrets"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets fails on a secret in the first commit of the repository",
	async () => {
		const repo = await makeRepo();
		writeFileSync(join(repo, "src/leak.ts"), secretLine());
		await must(repo, ["git", "add", "--all"]);
		await must(repo, [
			"git",
			"commit",
			"--quiet",
			"--no-verify",
			"--amend",
			"--no-edit",
		]);
		const count = await must(repo, ["git", "rev-list", "--count", "HEAD"]);
		expect(count.output.trim()).toBe("1");
		rmSync(join(repo, "src/leak.ts"));
		await commitAll(repo, "remove the file");
		await bury(repo);

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
		await bury(repo);
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
