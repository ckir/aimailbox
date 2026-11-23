/**
 * Proves where the checks run: `just check` is the full gate, `check-fast`
 * and `just test` leave the slow toolchain suite out, and the pre-push hook
 * runs that suite exactly when a push touches a file the suite tests.
 *
 * A throwaway repository has no `tests/toolchain/` of its own, so these tests
 * plant a marker test there: if `just test-toolchain` runs, the marker file
 * appears.
 */
import { afterAll, expect, test } from "bun:test";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	addRemote,
	cleanup,
	commitAll,
	FAILING_TEST,
	LEFTHOOK,
	makeRepo,
	must,
	run,
	SLOW,
	TOOLCHAIN_FILES,
} from "./helpers.ts";

afterAll(cleanup);

const MARKER = "TOOLCHAIN_SUITE_RAN";
const OTHER_MARKER = "OTHER_TESTS_RAN";

/** A test file that records that it ran by creating `marker` in the repository root. */
function markerTest(marker: string): string {
	return `import { test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

test("marker", () => {
	writeFileSync(join(import.meta.dir, "../..", "${marker}"), "ran\\n");
});
`;
}

/** A throwaway repository with a marker test standing in for the toolchain suite. */
async function makeRepoWithMarkerSuite(): Promise<string> {
	const repo = await makeRepo();
	mkdirSync(join(repo, "tests/toolchain"), { recursive: true });
	writeFileSync(
		join(repo, "tests/toolchain/marker.test.ts"),
		markerTest(MARKER),
	);
	await commitAll(repo, "add a marker toolchain test");
	return repo;
}

test.concurrent(
	"just check is the fast gate plus the toolchain suite",
	async () => {
		const repo = await makeRepo();
		// `--dry-run` prints every recipe line that would run, without running it.
		const result = await run(repo, ["just", "--dry-run", "check"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("tsc --noEmit");
		expect(result.output).toContain("biome check .");
		expect(result.output).toContain("bun test --path-ignore-patterns");
		expect(result.output).toContain("gitleaks git --staged");
		expect(result.output).toContain("gitleaks stdin");
		expect(result.output).toContain("gitleaks git --pre-commit");
		expect(result.output).toContain("bun test tests/toolchain");
	},
	SLOW,
);

test.concurrent(
	"just check-fast runs every check except the toolchain suite",
	async () => {
		const repo = await makeRepo();
		const result = await run(repo, ["just", "--dry-run", "check-fast"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("tsc --noEmit");
		expect(result.output).toContain("biome check .");
		expect(result.output).toContain("bun test --path-ignore-patterns");
		expect(result.output).toContain("gitleaks git --staged");
		expect(result.output).toContain("gitleaks stdin");
		expect(result.output).toContain("gitleaks git --pre-commit");
		expect(result.output).not.toContain("bun test tests/toolchain");
	},
	SLOW,
);

test.concurrent(
	"just test runs tests outside src but not the toolchain suite",
	async () => {
		const repo = await makeRepoWithMarkerSuite();
		mkdirSync(join(repo, "tests/other"), { recursive: true });
		writeFileSync(
			join(repo, "tests/other/other.test.ts"),
			markerTest(OTHER_MARKER),
		);
		const result = await run(repo, ["just", "test"]);
		expect(result.exitCode).toBe(0);
		expect(existsSync(join(repo, OTHER_MARKER))).toBe(true);
		expect(existsSync(join(repo, MARKER))).toBe(false);
	},
	SLOW,
);

test.concurrent(
	"just test-toolchain runs the toolchain suite",
	async () => {
		const repo = await makeRepoWithMarkerSuite();
		const result = await run(repo, ["just", "test-toolchain"]);
		expect(result.exitCode).toBe(0);
		expect(existsSync(join(repo, MARKER))).toBe(true);
	},
	SLOW,
);

// A recipe or hook job that swallowed a failure (for example with `|| true`)
// would still appear to run. These cases need the failure to come through.
test.concurrent(
	"just test fails when a test fails",
	async () => {
		const repo = await makeRepo();
		writeFileSync(join(repo, "src/failing.test.ts"), FAILING_TEST);
		const result = await run(repo, ["just", "test"]);
		expect(result.output).toContain("this test fails on purpose");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"just test-toolchain fails when a toolchain test fails",
	async () => {
		const repo = await makeRepo();
		mkdirSync(join(repo, "tests/toolchain"), { recursive: true });
		writeFileSync(join(repo, "tests/toolchain/failing.test.ts"), FAILING_TEST);
		const result = await run(repo, ["just", "test-toolchain"]);
		expect(result.output).toContain("this test fails on purpose");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"pre-push fails when the toolchain suite fails",
	async () => {
		const repo = await makeRepo();
		mkdirSync(join(repo, "tests/toolchain"), { recursive: true });
		writeFileSync(join(repo, "tests/toolchain/failing.test.ts"), FAILING_TEST);
		await commitAll(repo, "add a failing toolchain test");
		await addRemote(repo);
		appendFileSync(join(repo, "justfile"), "\n");
		await commitAll(repo, "touch the justfile");
		const result = await run(repo, [
			LEFTHOOK,
			"run",
			"pre-push",
			"--job",
			"toolchain-tests",
		]);
		expect(result.output).toContain("this test fails on purpose");
		expect(result.exitCode).not.toBe(0);
	},
	SLOW,
);

test.concurrent(
	"pre-push runs the toolchain suite when the push touches any file the suite tests",
	async () => {
		const repo = await makeRepoWithMarkerSuite();
		await addRemote(repo);

		// Every file the suite copies, with directories expanded, plus a file in
		// the suite's own directory.
		const listed = await must(repo, [
			"git",
			"ls-files",
			"--",
			...TOOLCHAIN_FILES,
		]);
		const files = [
			...listed.output.split("\n").filter((line) => line !== ""),
			"tests/toolchain/notes.txt",
		];
		expect(files.length).toBeGreaterThan(TOOLCHAIN_FILES.length);

		for (const file of files) {
			mkdirSync(dirname(join(repo, file)), { recursive: true });
			appendFileSync(join(repo, file), "\n");
			await commitAll(repo, `touch ${file}`);
			await run(repo, [
				LEFTHOOK,
				"run",
				"pre-push",
				"--job",
				"toolchain-tests",
			]);
			// The hook's exit code is not the point here, only whether the job ran.
			expect({ file, ran: existsSync(join(repo, MARKER)) }).toEqual({
				file,
				ran: true,
			});
			rmSync(join(repo, MARKER));
			await must(repo, ["git", "push", "--quiet", "--no-verify"]);
		}
	},
	SLOW,
);

test.concurrent(
	"pre-push skips the toolchain suite when the push touches no file the suite tests",
	async () => {
		const repo = await makeRepoWithMarkerSuite();
		await addRemote(repo);
		appendFileSync(join(repo, "src/index.ts"), "export const more = 1;\n");
		mkdirSync(join(repo, "docs"));
		writeFileSync(join(repo, "docs/notes.md"), "# Notes\n");
		await commitAll(repo, "change product code and docs");
		const result = await run(repo, [LEFTHOOK, "run", "pre-push"]);
		expect(result.output).toContain("toolchain-tests (skip)");
		expect(result.output).toContain("gitleaks git");
		expect(existsSync(join(repo, MARKER))).toBe(false);
		expect(result.exitCode).toBe(0);
	},
	SLOW,
);
