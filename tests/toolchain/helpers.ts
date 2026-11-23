/**
 * Helpers for the toolchain tests. Each test builds a throwaway git repository
 * holding a copy of this project's tooling files, then runs the real recipes
 * and hooks in it to prove a gate blocks what it should.
 *
 * Commands run asynchronously so the tests in a file can run concurrently:
 * the recipes are dominated by tool start-up time, not by CPU.
 */
import {
	appendFileSync,
	cpSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const repoRoot = resolve(import.meta.dir, "../..");

/** Long enough for a hook that runs the whole of `just check` on a busy machine. */
export const SLOW = 120_000;

/** The line gitleaks prints when it finds something ("no leaks found" has no colon). */
export const LEAK = "leaks found:";

/**
 * The tooling under test. `tests/` is deliberately left out, so `bun test`
 * inside a throwaway repository cannot run this suite again.
 */
const TOOLCHAIN_FILES = [
	".gitignore",
	".lefthook",
	"biome.json",
	"bun.lock",
	"justfile",
	"lefthook.yml",
	"package.json",
	"src",
	"tsconfig.json",
];

const created: string[] = [];

/**
 * The environment for every spawned command. Git exports `GIT_DIR` and
 * friends to hooks, and this suite runs inside the pre-push hook: left in
 * place, those variables would point the throwaway repositories' git commands
 * at the real repository. `LEFTHOOK*` is dropped so `LEFTHOOK=0` in the
 * caller's shell cannot switch the hooks under test off.
 */
export function cleanEnv(
	extra: Record<string, string> = {},
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (key.startsWith("GIT_") || key.startsWith("LEFTHOOK")) continue;
		env[key] = value;
	}
	return {
		...env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "Toolchain Test",
		GIT_AUTHOR_EMAIL: "toolchain-test@example.invalid",
		GIT_COMMITTER_NAME: "Toolchain Test",
		GIT_COMMITTER_EMAIL: "toolchain-test@example.invalid",
		...extra,
	};
}

export interface RunResult {
	exitCode: number;
	output: string;
}

/** Run a command and return its exit code and combined output. Never throws on failure. */
export async function run(
	cwd: string,
	cmd: string[],
	env: Record<string, string> = cleanEnv(),
): Promise<RunResult> {
	const child = Bun.spawn({
		cmd,
		cwd,
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, output: stdout + stderr };
}

/** Run a setup command that has to succeed; throw with its output if it does not. */
export async function must(
	cwd: string,
	cmd: string[],
	env: Record<string, string> = cleanEnv(),
): Promise<RunResult> {
	const result = await run(cwd, cmd, env);
	if (result.exitCode !== 0) {
		throw new Error(
			`setup command failed (${result.exitCode}): ${cmd.join(" ")}\n${result.output}`,
		);
	}
	return result;
}

/** A new empty directory outside any git repository. */
export function makeDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "aimailbox-toolchain-"));
	created.push(dir);
	return dir;
}

/**
 * A new git repository on branch `main` holding a copy of the tooling files,
 * with one commit and a clean working tree. `node_modules` is a link to this
 * project's, so `tsc` and `biome` resolve without an install.
 */
export async function makeRepo(): Promise<string> {
	const dir = makeDir();
	for (const file of TOOLCHAIN_FILES) {
		cpSync(join(repoRoot, file), join(dir, file), { recursive: true });
	}
	// The copied .gitignore ignores `node_modules/`, which matches a directory
	// but not the symlink created below.
	appendFileSync(join(dir, ".gitignore"), "\nnode_modules\n");
	symlinkSync(join(repoRoot, "node_modules"), join(dir, "node_modules"));
	await must(dir, ["git", "init", "--quiet", "--initial-branch=main"]);
	await commitAll(dir, "initial");
	return dir;
}

/** Stage everything and commit it, bypassing hooks. */
export async function commitAll(dir: string, message: string): Promise<void> {
	await must(dir, ["git", "add", "--all"]);
	await must(dir, ["git", "commit", "--quiet", "--no-verify", "-m", message]);
}

/** Give `dir` a bare remote named `origin` and push `main` to it, bypassing hooks. */
export async function addRemote(dir: string): Promise<void> {
	const remote = makeDir();
	await must(remote, ["git", "init", "--quiet", "--bare"]);
	await must(dir, ["git", "remote", "add", "origin", remote]);
	await must(dir, [
		"git",
		"push",
		"--quiet",
		"--no-verify",
		"--set-upstream",
		"origin",
		"main",
	]);
}

/**
 * A string shaped like a GitHub personal access token, generated at run time
 * so that no token-shaped literal is ever committed to this repository.
 */
export function fakeToken(): string {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = crypto.getRandomValues(new Uint8Array(36));
	let body = "";
	for (const byte of bytes) {
		body += alphabet[byte % alphabet.length];
	}
	return `ghp_${body}`;
}

/** Remove every directory this module created. Call from `afterAll`. */
export function cleanup(): void {
	for (const dir of created.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
}
