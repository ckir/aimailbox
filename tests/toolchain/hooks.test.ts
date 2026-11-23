/**
 * Proves the git hooks in lefthook.yml run, block a bad change, and cannot be
 * steered by hostile file names or remote URLs. The hooks are driven with
 * `lefthook run <hook>`, which executes the same jobs git would.
 */
import { afterAll, expect, test } from "bun:test";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	addRemote,
	cleanEnv,
	cleanup,
	fakeToken,
	LEAK,
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
		const result = await run(repo, ["lefthook", "validate"]);
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
		const result = await run(repo, ["lefthook", "run", "pre-push"]);
		expect(result.output).not.toContain("(skip)");
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
		const result = await run(repo, ["lefthook", "run", "pre-push"]);
		expect(result.output).toContain("TS2322");
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
			"lefthook",
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
		await must(repo, ["lefthook", "install"]);
		const hook = readFileSync(join(repo, ".git/hooks/pre-push"), "utf8");
		// Present only when `assert_lefthook_installed: true`.
		expect(hook).toContain("Operation is aborted due to lefthook settings");
	},
	SLOW,
);

test.concurrent(
	"an installed hook blocks the push when lefthook cannot be found",
	async () => {
		// `lefthook install` writes the path of the binary that ran it into the
		// hook as a fallback. Install from a private copy and then delete it, so
		// that neither that path nor PATH leads to lefthook.
		const repo = await makeRepo();
		const lefthook = Bun.which("lefthook");
		if (lefthook === null) throw new Error("lefthook is not on PATH");
		const copy = join(makeDir(), "lefthook");
		copyFileSync(lefthook, copy);
		chmodSync(copy, 0o755);
		await must(repo, [copy, "install"]);
		rmSync(copy);

		const path = binDirWith(["sh", "git", "uname", "tr", "sed"]);
		const result = await run(
			repo,
			[
				join(repo, ".git/hooks/pre-push"),
				"origin",
				"https://example.invalid/repo",
			],
			cleanEnv({ PATH: path }),
		);
		expect(result.output).toContain("Can't find lefthook in PATH");
		expect(result.output).toContain("Operation is aborted");
		expect(result.exitCode).toBe(1);
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
		const result = await run(repo, ["lefthook", "run", "pre-commit"]);
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
		const result = await run(repo, ["lefthook", "run", "pre-commit"]);
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
		const result = await run(repo, ["lefthook", "run", "pre-commit"]);
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
		const result = await run(repo, ["lefthook", "run", "pre-commit"]);
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just setup names a missing tool instead of failing later",
	async () => {
		const repo = await makeRepo();
		// Everything `setup` needs except gitleaks.
		const path = binDirWith(["bash", "just", "bun", "lefthook", "git"]);
		const result = await run(repo, ["just", "setup"], cleanEnv({ PATH: path }));
		expect(result.output).toContain("gitleaks is not installed");
		expect(result.exitCode).toBe(1);
	},
	SLOW,
);
