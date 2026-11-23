/**
 * Proves the installed git hooks run the lefthook pinned in package.json and
 * nothing else: not a `lefthook` on PATH, and not nothing at all.
 */
import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	cleanEnv,
	cleanup,
	LEFTHOOK,
	makeDir,
	makeRepo,
	must,
	repoRoot,
	run,
	SLOW,
} from "./helpers.ts";

afterAll(cleanup);

const PINNED = "bun ./node_modules/.bin/lefthook";

/** A directory holding a `lefthook` that records being run and reports success. */
function standInLefthook(marker: string): string {
	const bin = makeDir();
	writeFileSync(
		join(bin, "lefthook"),
		`#!/bin/sh\necho ran >> "${marker}"\nexit 0\n`,
	);
	chmodSync(join(bin, "lefthook"), 0o755);
	return bin;
}

test.concurrent(
	"installed hooks call the pinned lefthook before looking on PATH",
	async () => {
		const repo = await makeRepo();
		await must(repo, [LEFTHOOK, "install"]);
		for (const hook of ["pre-commit", "commit-msg", "pre-push"]) {
			const script = readFileSync(join(repo, ".git/hooks", hook), "utf8");
			const pinned = script.indexOf(PINNED);
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
	"without node_modules an installed hook fails instead of using a lefthook on PATH",
	async () => {
		// `bun run lefthook` would fall back to PATH here and report success.
		const repo = await makeRepo({ linkNodeModules: false });
		await must(repo, [LEFTHOOK, "install"]);
		const marker = join(repo, "PATH-LEFTHOOK-RAN");
		const bin = standInLefthook(marker);
		const result = await run(
			repo,
			[
				join(repo, ".git/hooks/pre-push"),
				"origin",
				"https://example.invalid/r",
			],
			cleanEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }),
		);
		expect(result.exitCode).not.toBe(0);
		expect(existsSync(marker)).toBe(false);
	},
	SLOW,
);

test.concurrent(
	"with node_modules an installed hook ignores a lefthook on PATH",
	async () => {
		const repo = await makeRepo();
		await must(repo, [LEFTHOOK, "install"]);
		const marker = join(repo, "PATH-LEFTHOOK-RAN");
		const bin = standInLefthook(marker);
		// pre-commit with nothing staged: the real lefthook runs and has nothing
		// to do. The stand-in would have left its marker.
		const result = await run(
			repo,
			[join(repo, ".git/hooks/pre-commit")],
			cleanEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }),
		);
		expect(result.exitCode).toBe(0);
		expect(existsSync(marker)).toBe(false);
	},
	SLOW,
);

test("package.json pins lefthook to one exact version", async () => {
	// A range such as ^2.1.17 would let a new release change what the hooks
	// run without a change to this repository.
	const manifest = (await Bun.file(join(repoRoot, "package.json")).json()) as {
		devDependencies?: Record<string, string>;
	};
	expect(manifest.devDependencies?.lefthook).toMatch(/^\d+\.\d+\.\d+$/);
});
