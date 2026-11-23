/**
 * Proves the strictness this project relies on is switched on: each case is
 * code that only a specific TypeScript or Biome setting rejects. The
 * placeholder source is too small to exercise any of them by itself.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
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

test.concurrent(
	"typecheck covers tests/ as well as src/",
	async () => {
		const repo = await makeRepo();
		mkdirSync(join(repo, "tests"));
		writeFileSync(
			join(repo, "tests/bad.ts"),
			'export const n: number = "not a number";\n',
		);
		const result = await run(repo, ["just", "typecheck"]);
		expect(result.output).toContain("tests/bad.ts");
		expect(result.output).toContain("TS2322");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"typecheck rejects a type imported without `type` (verbatimModuleSyntax)",
	async () => {
		// Bun strips types per file; an import that is only a type must say so
		// or it is kept as a runtime import of something that does not exist.
		const repo = await makeRepo();
		writeFileSync(
			join(repo, "src/types.ts"),
			"export interface Shape {\n\tsides: number;\n}\n",
		);
		writeFileSync(
			join(repo, "src/use-types.ts"),
			'import { Shape } from "./types.ts";\n\nexport const square: Shape = { sides: 4 };\n',
		);
		const result = await run(repo, ["just", "typecheck"]);
		expect(result.output).toContain("TS1484");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"typecheck rejects a switch case that falls through (noFallthroughCasesInSwitch)",
	async () => {
		const repo = await makeRepo();
		writeFileSync(
			join(repo, "src/fallthrough.ts"),
			'export function label(n: number): string {\n\tlet out = "";\n\tswitch (n) {\n\t\tcase 1:\n\t\t\tout += "one";\n\t\tcase 2:\n\t\t\tout += "two";\n\t\t\tbreak;\n\t}\n\treturn out;\n}\n',
		);
		const result = await run(repo, ["just", "typecheck"]);
		expect(result.output).toContain("TS7029");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"typecheck rejects an override without `override` (noImplicitOverride)",
	async () => {
		const repo = await makeRepo();
		writeFileSync(
			join(repo, "src/override.ts"),
			'export class Base {\n\tname(): string {\n\t\treturn "base";\n\t}\n}\n\nexport class Child extends Base {\n\tname(): string {\n\t\treturn "child";\n\t}\n}\n',
		);
		const result = await run(repo, ["just", "typecheck"]);
		expect(result.output).toContain("TS4114");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"lint skips files that .gitignore ignores",
	async () => {
		// `dist` is in .gitignore. Biome only honours that because
		// `vcs.useIgnoreFile` is on; otherwise build output would fail the lint.
		const repo = await makeRepo();
		mkdirSync(join(repo, "dist"));
		writeFileSync(join(repo, "dist/generated.js"), "debugger;\n");
		const result = await run(repo, ["just", "lint"]);
		expect(result.output).not.toContain("noDebugger");
		expect(result.exitCode).toBe(0);
	},
	SLOW,
);

test.concurrent(
	"lint rejects unsorted imports",
	async () => {
		const repo = await makeRepo();
		writeFileSync(
			join(repo, "src/unsorted.ts"),
			'import { join } from "node:path";\nimport { existsSync } from "node:fs";\n\nexport const found = existsSync(join("a", "b"));\n',
		);
		const result = await run(repo, ["just", "lint"]);
		expect(result.output).toContain("organizeImports");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);
