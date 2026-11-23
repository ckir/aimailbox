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
		// `lefthook install` writes the absolute path of the binary that ran it
		// into the hook as a fallback, so hiding lefthook from PATH is not enough.
		// Point that fallback at a path that does not exist, which is what the
		// hook sees after lefthook has been uninstalled or moved.
		const repo = await makeRepo();
		await must(repo, ["lefthook", "install"]);
		const hookPath = join(repo, ".git/hooks/pre-push");
		const original = readFileSync(hookPath, "utf8");
		const embedded = /(?<=\s)\/\S*lefthook(?=\s)/g;
		expect(original).toMatch(embedded);
		writeFileSync(
			hookPath,
			original.replace(embedded, "/nonexistent/lefthook"),
		);

		const path = binDirWith(["sh", "git", "uname", "tr", "sed"]);
		const result = await run(
			repo,
			[hookPath, "origin", "https://example.invalid/repo"],
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
	"just setup names a missing tool and installs nothing",
	async () => {
		// PATH holds everything `setup` needs except gitleaks. `bun` and
		// `lefthook` are stand-ins that only record that they ran, so that a
		// broken guard cannot start a real install from inside this test.
		const repo = await makeRepo({ linkNodeModules: false });
		const path = binDirWith(["bash", "just", "git"]);
		const ran = join(repo, "INSTALLER-RAN");
		for (const name of ["bun", "lefthook"]) {
			writeFileSync(join(path, name), `#!/bin/sh\necho ${name} >> "${ran}"\n`);
			chmodSync(join(path, name), 0o755);
		}
		const result = await run(repo, ["just", "setup"], cleanEnv({ PATH: path }));
		expect(result.output).toContain("gitleaks is not installed");
		expect(result.exitCode).toBe(1);
		expect(existsSync(ran)).toBe(false);
	},
	SLOW,
);
