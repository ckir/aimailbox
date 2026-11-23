/**
 * Proves `just setup` leaves a repository with working git hooks, by going
 * through git itself: a real `git commit` and a real `git push`, not
 * `lefthook run`. This is the one place the suite checks that git actually
 * dispatches to the hooks.
 */
import { afterAll, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	addRemote,
	cleanEnv,
	cleanup,
	makeDir,
	makeRepo,
	must,
	run,
	SLOW,
} from "./helpers.ts";

afterAll(cleanup);

const TYPE_ERROR = 'export const n: number = "not a number";\n';

/**
 * Run `just setup` in `repo` with the real tools, except `bun`, which is a
 * stub: the throwaway repository already has `node_modules`, and a real
 * `bun install` would write through that link into this project.
 */
async function setUp(repo: string): Promise<void> {
	const bin = makeDir();
	for (const name of ["bash", "just", "git", "lefthook", "gitleaks", "sh"]) {
		const target = Bun.which(name);
		if (target === null) throw new Error(`${name} is not on PATH`);
		symlinkSync(target, join(bin, name));
	}
	writeFileSync(join(bin, "bun"), "#!/bin/sh\nexit 0\n");
	chmodSync(join(bin, "bun"), 0o755);
	await must(repo, ["just", "setup"], cleanEnv({ PATH: bin }));
}

test.concurrent(
	"just setup installs the pre-commit and pre-push hooks",
	async () => {
		const repo = await makeRepo();
		expect(existsSync(join(repo, ".git/hooks/pre-commit"))).toBe(false);
		await setUp(repo);
		expect(existsSync(join(repo, ".git/hooks/pre-commit"))).toBe(true);
		expect(existsSync(join(repo, ".git/hooks/pre-push"))).toBe(true);
	},
	SLOW,
);

test.concurrent(
	"after just setup, git commit is blocked by a type error and allowed without one",
	async () => {
		const repo = await makeRepo();
		await setUp(repo);

		writeFileSync(join(repo, "src/bad.ts"), TYPE_ERROR);
		await must(repo, ["git", "add", "src/bad.ts"]);
		const blocked = await run(repo, [
			"git",
			"commit",
			"-m",
			"add a type error",
		]);
		expect(blocked.output).toContain("TS2322");
		expect(blocked.exitCode).not.toBe(0);
		const after = await must(repo, ["git", "rev-list", "--count", "HEAD"]);
		expect(after.output.trim()).toBe("1");

		await must(repo, ["git", "rm", "--quiet", "--cached", "src/bad.ts"]);
		await must(repo, ["rm", "src/bad.ts"]);
		mkdirSync(join(repo, "tools"));
		writeFileSync(join(repo, "tools/ok.mjs"), "export const ok = true;\n");
		await must(repo, ["git", "add", "tools/ok.mjs"]);
		const allowed = await run(repo, [
			"git",
			"commit",
			"-m",
			"add a clean file",
		]);
		expect(allowed.exitCode).toBe(0);
		const count = await must(repo, ["git", "rev-list", "--count", "HEAD"]);
		expect(count.output.trim()).toBe("2");
	},
	SLOW,
);

test.concurrent(
	"after just setup, git push is blocked by a failing check and allowed without one",
	async () => {
		const repo = await makeRepo();
		await addRemote(repo);
		await setUp(repo);

		// Untracked, so nothing is being pushed for it: the fast gate still sees it.
		writeFileSync(join(repo, "src/bad.ts"), TYPE_ERROR);
		const blocked = await run(repo, ["git", "push", "origin", "main"]);
		expect(blocked.output).toContain("TS2322");
		expect(blocked.exitCode).not.toBe(0);

		await must(repo, ["rm", "src/bad.ts"]);
		const allowed = await run(repo, ["git", "push", "origin", "main"]);
		expect(allowed.exitCode).toBe(0);
	},
	SLOW,
);
