/**
 * Proves the strictness this project relies on is switched on: each case is
 * code that only a specific TypeScript or Biome setting rejects. The
 * placeholder source is too small to exercise any of them by itself.
 */
import { afterAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, makeRepo, run, SLOW } from "./helpers.ts";

afterAll(cleanup);

test.concurrent(
	"typecheck and lint pass on the unmodified project",
	async () => {
		const repo = await makeRepo();
		const typecheck = await run(repo, ["just", "typecheck"]);
		expect(typecheck.exitCode).toBe(0);
		const lint = await run(repo, ["just", "lint"]);
		expect(lint.exitCode).toBe(0);
	},
	SLOW,
);

test.concurrent(
	"typecheck rejects an implicit any (strict)",
	async () => {
		const repo = await makeRepo();
		writeFileSync(
			join(repo, "src/loose.ts"),
			"export function identity(value) {\n\treturn value;\n}\n",
		);
		const result = await run(repo, ["just", "typecheck"]);
		expect(result.output).toContain("TS7006");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"typecheck rejects an unchecked array index (noUncheckedIndexedAccess)",
	async () => {
		const repo = await makeRepo();
		writeFileSync(
			join(repo, "src/index-access.ts"),
			"const values: number[] = [];\nexport const first: number = values[0];\n",
		);
		const result = await run(repo, ["just", "typecheck"]);
		expect(result.output).toContain("TS2322");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"lint rejects a recommended-rule violation",
	async () => {
		const repo = await makeRepo();
		writeFileSync(
			join(repo, "src/debug.ts"),
			"export function stop(): void {\n\tdebugger;\n}\n",
		);
		const result = await run(repo, ["just", "lint"]);
		expect(result.output).toContain("noDebugger");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"lint rejects unformatted code",
	async () => {
		const repo = await makeRepo();
		writeFileSync(
			join(repo, "src/unformatted.ts"),
			"export   const   spaced   =   1\n",
		);
		const result = await run(repo, ["just", "lint"]);
		expect(result.output).toContain("src/unformatted.ts");
		expect(result.output).toContain("format");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);
