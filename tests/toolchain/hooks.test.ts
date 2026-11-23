/**
 * Proves the git hooks in lefthook.yml run, block a bad change, and cannot be
 * steered by hostile file names or remote URLs. The hooks are driven with
 * `lefthook run <hook>`, which executes the same jobs git would.
 */
import { afterAll, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	addRemote,
	cleanEnv,
	cleanup,
	commitAll,
	FAILING_TEST,
	fakeToken,
	LEAK,
	LEFTHOOK,
	makeDir,
	makeRepo,
	must,
	run,
	SLOW,
} from "./helpers.ts";

afterAll(cleanup);

const TYPE_ERROR = 'export const n: number = "not a number";\n';

/** A directory holding links to the named programs, for use as a whole PATH. */
function binDirWith(names: string[]): string {
	const dir = makeDir();
	for (const name of names) {
		const target = Bun.which(name);
		if (target === null) throw new Error(`${name} is not on PATH`);
		symlinkSync(target, join(dir, name));
	}
	return dir;
}

test.concurrent(
	"lefthook accepts the configuration",
	async () => {
		const repo = await makeRepo();
		const result = await run(repo, [LEFTHOOK, "validate"]);
		expect(result.exitCode).toBe(0);
	},
	SLOW,
);

test.concurrent(
	"pre-push runs just check even when there is nothing to push",
	async () => {
		// lefthook skips a pre-push `run` job when the push changes no files.
		// The job is a script so that it always runs.
		const repo = await makeRepo();
		await addRemote(repo);
		const result = await run(repo, [LEFTHOOK, "run", "pre-push"]);
		expect(result.output).not.toContain("check (skip)");
		expect(result.output).toContain("gitleaks git");
		expect(result.exitCode).toBe(0);
	},
	SLOW,
);

test.concurrent(
	"pre-push fails on a type error even when there is nothing to push",
	async () => {
		const repo = await makeRepo();
		await addRemote(repo);
		writeFileSync(join(repo, "src/bad.ts"), TYPE_ERROR);
		const result = await run(repo, [LEFTHOOK, "run", "pre-push"]);
		expect(result.output).toContain("TS2322");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

// The fast gate has four parts. Each case below is caught by exactly one of
// them, so the hook cannot quietly stop running a part.
test.concurrent(
	"pre-push fails on a lint error even when there is nothing to push",
	async () => {
		const repo = await makeRepo();
		await addRemote(repo);
		// Outside `src`, so the type check does not see it.
		mkdirSync(join(repo, "tools"));
		writeFileSync(join(repo, "tools/bad.mjs"), "debugger;\n");
		const result = await run(repo, [LEFTHOOK, "run", "pre-push"]);
		expect(result.output).toContain("noDebugger");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"pre-push fails on a failing test even when there is nothing to push",
	async () => {
		const repo = await makeRepo();
		await addRemote(repo);
		writeFileSync(join(repo, "src/failing.test.ts"), FAILING_TEST);
		const result = await run(repo, [LEFTHOOK, "run", "pre-push"]);
		expect(result.output).toContain("this test fails on purpose");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"pre-push fails on a secret in the history being pushed",
	async () => {
		const repo = await makeRepo();
		await addRemote(repo);
		writeFileSync(
			join(repo, "src/leak.ts"),
			`export const token = "${fakeToken()}";\n`,
		);
		await commitAll(repo, "add a file");
		const result = await run(repo, [LEFTHOOK, "run", "pre-push"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"pre-push does not execute shell syntax in the remote URL",
	async () => {
		// Git passes the remote name and URL to the hook. Without explicit
		// `args`, lefthook appends them unquoted to the shell command.
		const repo = await makeRepo();
		await addRemote(repo);
		const result = await run(repo, [
			LEFTHOOK,
			"run",
			"pre-push",
			"origin",
			"https://example.invalid/repo;touch INJECTED",
		]);
		expect(existsSync(join(repo, "INJECTED"))).toBe(false);
		expect(result.output).toContain("gitleaks git");
		expect(result.exitCode).toBe(0);
	},
	SLOW,
);

test.concurrent(
	"installed hooks are generated to fail when lefthook is missing",
	async () => {
		const repo = await makeRepo();
		await must(repo, [LEFTHOOK, "install"]);
		const hook = readFileSync(join(repo, ".git/hooks/pre-push"), "utf8");
		// Present only when `assert_lefthook_installed: true`.
		expect(hook).toContain("Operation is aborted due to lefthook settings");
	},
	SLOW,
);

test.concurrent(
	"an installed hook blocks the push when the project's lefthook is missing",
	async () => {
		// The generated hook runs `bun run --bun lefthook`, the copy pinned in
		// package.json. With no node_modules there is nothing for it to run, and
		// the push must be refused rather than waved through.
		const repo = await makeRepo({ linkNodeModules: false });
		await must(repo, [LEFTHOOK, "install"]);
		const result = await run(repo, [
			join(repo, ".git/hooks/pre-push"),
			"origin",
			"https://example.invalid/repo",
		]);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"installed hooks call the lefthook pinned in package.json",
	async () => {
		// Without the `lefthook:` setting the generated hook tries a `lefthook`
		// on PATH first, which may be any version.
		const repo = await makeRepo();
		await must(repo, [LEFTHOOK, "install"]);
		for (const hook of ["pre-commit", "commit-msg", "pre-push"]) {
			const script = readFileSync(join(repo, ".git/hooks", hook), "utf8");
			const pinned = script.indexOf("bun run --bun lefthook");
			const onPath = script.indexOf("elif lefthook -h");
			expect({ hook, pinned: pinned > 0 }).toEqual({ hook, pinned: true });
			expect({ hook, pinnedFirst: pinned < onPath }).toEqual({
				hook,
				pinnedFirst: true,
			});
		}
	},
	SLOW,
);

test.concurrent(
	"pre-commit passes on a well-formed staged file",
	async () => {
		const repo = await makeRepo();
		mkdirSync(join(repo, "tools"));
		writeFileSync(join(repo, "tools/ok.mjs"), "export const ok = true;\n");
		await must(repo, ["git", "add", "tools/ok.mjs"]);
		const result = await run(repo, [LEFTHOOK, "run", "pre-commit"]);
		expect(result.exitCode).toBe(0);
	},
	SLOW,
);

test.concurrent(
	"pre-commit lints file types beyond .ts and is not steered by flag-like file names",
	async () => {
		// tools/bad.mjs is outside `src`, so only Biome can reject it: the type
		// check does not see it. Files named like Biome flags are staged beside
		// it; without `--` before the file list, `-h` makes Biome print its help
		// and exit 0, and `--linter-enabled=false` switches the linter off.
		const repo = await makeRepo();
		mkdirSync(join(repo, "tools"));
		writeFileSync(join(repo, "tools/bad.mjs"), "debugger;\n");
		writeFileSync(join(repo, "-h"), "");
		writeFileSync(join(repo, "--linter-enabled=false"), "");
		await must(repo, [
			"git",
			"add",
			"--",
			"tools/bad.mjs",
			"-h",
			"--linter-enabled=false",
		]);
		const result = await run(repo, [LEFTHOOK, "run", "pre-commit"]);
		expect(result.output).toContain("noDebugger");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"pre-commit fails on a type error in a staged file",
	async () => {
		const repo = await makeRepo();
		writeFileSync(join(repo, "src/bad.ts"), TYPE_ERROR);
		await must(repo, ["git", "add", "src/bad.ts"]);
		const result = await run(repo, [LEFTHOOK, "run", "pre-commit"]);
		expect(result.output).toContain("TS2322");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"pre-commit fails on a secret in a staged file",
	async () => {
		const repo = await makeRepo();
		mkdirSync(join(repo, "notes"));
		writeFileSync(join(repo, "notes/keys.txt"), `token = "${fakeToken()}"\n`);
		await must(repo, ["git", "add", "notes/keys.txt"]);
		const result = await run(repo, [LEFTHOOK, "run", "pre-commit"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"commit-msg fails on a secret in the commit message",
	async () => {
		const repo = await makeRepo();
		const message = join(repo, ".git/COMMIT_EDITMSG");
		writeFileSync(
			message,
			`deploy the service\n\nUploads use ${fakeToken()} for now.\n`,
		);
		const result = await run(repo, [LEFTHOOK, "run", "commit-msg", message]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"commit-msg passes on an ordinary commit message",
	async () => {
		const repo = await makeRepo();
		const message = join(repo, ".git/COMMIT_EDITMSG");
		writeFileSync(message, "deploy the service\n\nNothing secret here.\n");
		const result = await run(repo, [LEFTHOOK, "run", "commit-msg", message]);
		expect(result.output).not.toContain(LEAK);
		expect(result.exitCode).toBe(0);
	},
	SLOW,
);

test.concurrent(
	"commit-msg reads a message file whose path contains a space",
	async () => {
		// In a linked worktree, or a clone under a directory with a space in its
		// name, git passes such a path to the hook.
		const repo = await makeRepo();
		const dir = join(repo, ".git", "with space");
		mkdirSync(dir);
		const message = join(dir, "MESSAGE");
		writeFileSync(message, `release notes\n\nToken ${fakeToken()}\n`);
		const result = await run(repo, [LEFTHOOK, "run", "commit-msg", message]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"commit-msg does not run shell syntax in the message file's path",
	async () => {
		// In a linked worktree git passes the absolute path of the message file,
		// so the directory names are whatever the user chose.
		const repo = await makeRepo();
		const dir = join(repo, 'odd $(touch INJECTED-A) `touch INJECTED-B` " dir');
		mkdirSync(dir);

		const clean = join(dir, "CLEAN_MSG");
		writeFileSync(clean, "deploy the service\n");
		const passed = await run(repo, [LEFTHOOK, "run", "commit-msg", clean]);
		expect(passed.exitCode).toBe(0);

		const leaky = join(dir, "LEAKY_MSG");
		writeFileSync(leaky, `deploy with ${fakeToken()}\n`);
		const blocked = await run(repo, [LEFTHOOK, "run", "commit-msg", leaky]);
		expect(blocked.output).toContain(LEAK);
		expect(blocked.exitCode).not.toBe(0);

		expect(existsSync(join(repo, "INJECTED-A"))).toBe(false);
		expect(existsSync(join(repo, "INJECTED-B"))).toBe(false);
	},
	SLOW,
);

test.concurrent(
	"just secrets-message does not run shell syntax in its argument",
	async () => {
		const repo = await makeRepo();
		const dir = join(repo, 'odd $(touch INJECTED-A) `touch INJECTED-B` " dir');
		mkdirSync(dir);
		const message = join(dir, "MSG");
		writeFileSync(message, "deploy the service\n");
		const result = await run(repo, ["just", "secrets-message", message]);
		expect(result.exitCode).toBe(0);
		expect(existsSync(join(repo, "INJECTED-A"))).toBe(false);
		expect(existsSync(join(repo, "INJECTED-B"))).toBe(false);
	},
	SLOW,
);

test.concurrent(
	"just setup names a missing tool and installs nothing",
	async () => {
		// PATH holds everything `setup` needs except gitleaks. `bun` is a
		// stand-in that only records that it ran, so that a broken guard cannot
		// start a real install from inside this test.
		const repo = await makeRepo({ linkNodeModules: false });
		const path = binDirWith(["bash", "just", "git"]);
		const ran = join(repo, "INSTALLER-RAN");
		writeFileSync(join(path, "bun"), `#!/bin/sh\necho bun >> "${ran}"\n`);
		chmodSync(join(path, "bun"), 0o755);
		const result = await run(repo, ["just", "setup"], cleanEnv({ PATH: path }));
		expect(result.output).toContain("gitleaks is not installed");
		expect(result.exitCode).toBe(1);
		expect(existsSync(ran)).toBe(false);
	},
	SLOW,
);
