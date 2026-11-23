/**
 * Proves what the pre-commit Biome job does to the commit itself: formatting
 * fixes land in what is committed, unstaged work survives, and a commit with
 * nothing for Biome to check is not blocked.
 */
import { afterAll, expect, test } from "bun:test";
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { cleanup, LEFTHOOK, makeRepo, must, run, SLOW } from "./helpers.ts";

afterAll(cleanup);

const UNFORMATTED = "export   const   value   =   1\n";
const FORMATTED = "export const value = 1;\n";

test.concurrent(
	"pre-commit stages Biome's formatting fixes",
	async () => {
		// Without `--write` the job fails on unformatted code; without
		// `stage_fixed` it fixes the working copy but commits the original.
		const repo = await makeRepo();
		mkdirSync(join(repo, "tools"));
		writeFileSync(join(repo, "tools/value.mjs"), UNFORMATTED);
		await must(repo, ["git", "add", "tools/value.mjs"]);

		const result = await run(repo, [LEFTHOOK, "run", "pre-commit"]);
		expect(result.exitCode).toBe(0);
		const staged = await must(repo, ["git", "show", ":tools/value.mjs"]);
		expect(staged.output).toBe(FORMATTED);
	},
	SLOW,
);

test.concurrent(
	"pre-commit leaves unstaged changes in the working tree",
	async () => {
		const repo = await makeRepo();
		mkdirSync(join(repo, "tools"));
		writeFileSync(join(repo, "tools/value.mjs"), UNFORMATTED);
		await must(repo, ["git", "add", "tools/value.mjs"]);
		// A change to a tracked file that is deliberately not staged.
		appendFileSync(join(repo, "src/index.ts"), "export const draft = 2;\n");

		const result = await run(repo, [LEFTHOOK, "run", "pre-commit"]);
		expect(result.exitCode).toBe(0);
		expect(readFileSync(join(repo, "src/index.ts"), "utf8")).toContain(
			"export const draft = 2;",
		);
		const staged = await must(repo, ["git", "diff", "--cached", "--name-only"]);
		expect(staged.output.trim().split("\n")).toEqual(["tools/value.mjs"]);
		const unstaged = await must(repo, ["git", "diff", "--name-only"]);
		expect(unstaged.output.trim().split("\n")).toEqual(["src/index.ts"]);
	},
	SLOW,
);

test.concurrent(
	"pre-commit passes when no staged file is one Biome checks",
	async () => {
		// Without `--no-errors-on-unmatched`, Biome exits non-zero when every
		// file it was given is of a type it ignores.
		const repo = await makeRepo();
		mkdirSync(join(repo, "notes"));
		writeFileSync(join(repo, "notes/plain.txt"), "nothing to check here\n");
		await must(repo, ["git", "add", "notes/plain.txt"]);

		const result = await run(repo, [LEFTHOOK, "run", "pre-commit"]);
		expect(result.exitCode).toBe(0);
	},
	SLOW,
);
