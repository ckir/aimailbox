/**
 * Proves the commit-msg hook scans the commit message for secrets, and that
 * the path of the message file can never be run as shell syntax.
 *
 * These go through the hook script lefthook installs, not `lefthook run`,
 * because the path reaches the recipe through .lefthook/rc.sh, which only that
 * script sources.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	cleanEnv,
	cleanup,
	fakeToken,
	LEAK,
	LEFTHOOK,
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
		// every way of breaking out of a quoted shell word.
		const { repo, hook } = await repoWithHook();
		const dir = join(
			repo,
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
		expect(result.output).toContain("HOOK_ARG_1 is not set");
		expect(result.exitCode).not.toBe(0);
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
