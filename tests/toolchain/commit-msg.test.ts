/**
 * Proves the commit-msg hook scans the commit message for secrets, and that
 * the path of the message file can never be run as shell syntax.
 *
 * These go through the hook script lefthook installs, not `lefthook run`,
 * because the path reaches the recipe through .lefthook/rc.sh, which only that
 * script sources.
 */
import { afterAll, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	cleanEnv,
	cleanup,
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

/** A throwaway repository with the hooks installed, and its commit-msg hook. */
async function repoWithHook(): Promise<{ repo: string; hook: string }> {
	const repo = await makeRepo();
	await must(repo, [LEFTHOOK, "install"]);
	return { repo, hook: join(repo, ".git/hooks/commit-msg") };
}

const CLEAN = "deploy the service\n\nNothing secret here.\n";
const leaky = () =>
	`deploy the service\n\nUploads use ${fakeToken()} for now.\n`;

test.concurrent(
	"commit-msg blocks a secret in the message and passes a clean one",
	async () => {
		const { repo, hook } = await repoWithHook();
		const message = join(repo, ".git/COMMIT_EDITMSG");

		writeFileSync(message, leaky());
		const blocked = await run(repo, [hook, message]);
		expect(blocked.output).toContain(LEAK);
		expect(blocked.exitCode).not.toBe(0);

		writeFileSync(message, CLEAN);
		const passed = await run(repo, [hook, message]);
		expect(passed.output).not.toContain(LEAK);
		expect(passed.exitCode).toBe(0);
	},
	SLOW,
);

test.concurrent(
	"commit-msg never runs shell syntax in the message file's path",
	async () => {
		// In a linked worktree git passes the absolute path of the message file,
		// so its directory names are whatever the user chose. This one carries
		// every way of breaking out of a quoted shell word. It sits inside .git,
		// as a real message file does.
		const { repo, hook } = await repoWithHook();
		const dir = join(
			repo,
			".git",
			// `$` + `{IFS}` is written in two parts only to keep the linter from
			// reading it as a forgotten template placeholder.
			`odd $(touch INJECTED-A) \`touch INJECTED-B\` " ';touch$` +
				"{IFS}INJECTED-C;true;# dir",
		);
		mkdirSync(dir);

		const message = join(dir, "MSG");
		writeFileSync(message, CLEAN);
		const passed = await run(repo, [hook, message]);
		expect(passed.exitCode).toBe(0);

		writeFileSync(message, leaky());
		const blocked = await run(repo, [hook, message]);
		expect(blocked.output).toContain(LEAK);
		expect(blocked.exitCode).not.toBe(0);

		for (const marker of ["INJECTED-A", "INJECTED-B", "INJECTED-C"]) {
			expect({ marker, created: existsSync(join(repo, marker)) }).toEqual({
				marker,
				created: false,
			});
		}
	},
	SLOW,
);

test.concurrent(
	"commit-msg scans the file git names, not one left in the caller's environment",
	async () => {
		const { repo, hook } = await repoWithHook();
		const message = join(repo, ".git/COMMIT_EDITMSG");
		writeFileSync(message, leaky());
		const result = await run(repo, [hook, message], {
			...cleanEnv(),
			HOOK_ARG_1: "/dev/null",
		});
		expect(result.output).toContain(LEAK);
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"commit-msg fails when .lefthook/rc.sh is missing",
	async () => {
		// Without the rc file nothing tells the recipe which file to scan. It
		// must refuse, not pass.
		const { repo, hook } = await repoWithHook();
		rmSync(join(repo, ".lefthook/rc.sh"));
		const message = join(repo, ".git/COMMIT_EDITMSG");
		writeFileSync(message, CLEAN);
		const result = await run(repo, [hook, message]);
		expect(result.output).toContain("rc.sh is missing");
		expect(result.exitCode).not.toBe(0);

		// lefthook skips a missing rc file without complaint, so a value already
		// in the environment would otherwise be scanned in place of the message.
		writeFileSync(message, leaky());
		const spoofed = await run(repo, [hook, message], {
			...cleanEnv(),
			HOOK_ARG_1: "/dev/null",
		});
		expect(spoofed.output).toContain("rc.sh is missing");
		expect(spoofed.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets-message fails outside the hook",
	async () => {
		const repo = await makeRepo();
		const result = await run(repo, ["just", "secrets-message"]);
		expect(result.output).toContain("HOOK_ARG_1 is not set");
		expect(result.exitCode).toBe(1);
	},
	SLOW,
);

test.concurrent(
	"commit-msg refuses a path that is not a regular file, even with rc.sh emptied",
	async () => {
		// An rc.sh that exists but exports nothing leaves whatever the caller had
		// in HOOK_ARG_1. /dev/null would scan clean; it is not a message file.
		const { repo, hook } = await repoWithHook();
		writeFileSync(join(repo, ".lefthook/rc.sh"), "# emptied\n");
		const message = join(repo, ".git/COMMIT_EDITMSG");
		writeFileSync(message, leaky());
		const result = await run(repo, [hook, message], {
			...cleanEnv(),
			HOOK_ARG_1: "/dev/null",
		});
		expect(result.output).toContain("does not name a regular file");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just secrets-message refuses a file outside the git directory",
	async () => {
		// Git keeps every commit message file inside the git directory. A clean
		// file anywhere else is not the message being committed.
		const repo = await makeRepo();
		mkdirSync(join(repo, "notes"));
		const elsewhere = join(repo, "notes/clean.txt");
		writeFileSync(elsewhere, CLEAN);
		const result = await run(repo, ["just", "secrets-message"], {
			...cleanEnv(),
			HOOK_ARG_1: elsewhere,
		});
		expect(result.output).toContain("outside the git directory");
		expect(result.exitCode).toBe(1);
	},
	SLOW,
);

test.concurrent(
	"in a linked worktree, git commit is blocked by a secret in the message and allowed without one",
	async () => {
		// The worktree's message file lives under the main repository's
		// .git/worktrees/, and git passes its absolute path to the hook.
		const { repo } = await repoWithHook();
		const worktree = join(makeDir(), "linked");
		await must(repo, [
			"git",
			"worktree",
			"add",
			"--quiet",
			"-b",
			"linked",
			worktree,
		]);
		symlinkSync(join(repo, "node_modules"), join(worktree, "node_modules"));

		writeFileSync(join(worktree, "note.txt"), "a note\n");
		await must(worktree, ["git", "add", "note.txt"]);
		const blocked = await run(worktree, [
			"git",
			"commit",
			"-m",
			`add a note\n\nUploads use ${fakeToken()} for now.`,
		]);
		expect(blocked.output).toContain(LEAK);
		expect(blocked.exitCode).not.toBe(0);

		const allowed = await run(worktree, ["git", "commit", "-m", "add a note"]);
		expect(allowed.exitCode).toBe(0);
		const count = await must(worktree, ["git", "rev-list", "--count", "HEAD"]);
		expect(count.output.trim()).toBe("2");
	},
	SLOW,
);

test.concurrent(
	"commit-msg works when the caller has CDPATH set",
	async () => {
		// With CDPATH set, `cd` prints the directory it chose. The recipe captures
		// the output of `cd ... && pwd`, so that extra line used to make every
		// message file look as if it were outside the git directory.
		const { repo, hook } = await repoWithHook();
		const env = { ...cleanEnv(), CDPATH: `.:${repo}` };
		const message = join(repo, ".git/COMMIT_EDITMSG");

		writeFileSync(message, CLEAN);
		const passed = await run(repo, [hook, message], env);
		expect(passed.exitCode).toBe(0);

		writeFileSync(message, leaky());
		const blocked = await run(repo, [hook, message], env);
		expect(blocked.output).toContain(LEAK);
		expect(blocked.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"commit-msg refuses a symbolic link standing in for the message file",
	async () => {
		// Git writes message files itself and never as links. A link inside
		// .git pointing at a clean file elsewhere is not the message.
		const { repo, hook } = await repoWithHook();
		mkdirSync(join(repo, "notes"));
		writeFileSync(join(repo, "notes/clean.txt"), CLEAN);
		const link = join(repo, ".git/LINKED_MSG");
		symlinkSync(join(repo, "notes/clean.txt"), link);
		const result = await run(repo, [hook, link]);
		expect(result.output).toContain("does not name a regular file");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);
