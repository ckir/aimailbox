/**
 * Pins the CODEOWNERS entries that route changes to the CI workflow, the
 * recipes and hooks, and the tests guarding them, to the owner. Like the
 * workflow tests, this reads a file; whether GitHub enforces it depends on
 * branch protection.
 */
import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

/** The owned paths in CODEOWNERS, each mapped to its owners. */
async function entries(): Promise<Map<string, string[]>> {
	const text = await Bun.file(join(repoRoot, ".github/CODEOWNERS")).text();
	const result = new Map<string, string[]>();
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const [path, ...owners] = trimmed.split(/\s+/);
		if (path !== undefined) result.set(path, owners);
	}
	return result;
}

test("the CI workflow, the recipes, the hooks, their tests and CODEOWNERS each have an owner", async () => {
	const owned = await entries();
	for (const path of [
		"/.github/workflows/",
		"/.github/CODEOWNERS",
		"/tests/gate/",
		"/justfile",
		"/lefthook.yml",
		"/.lefthook/",
		"/tests/toolchain/",
	]) {
		const owners = owned.get(path) ?? [];
		expect({ path, hasOwner: owners.length > 0 }).toEqual({
			path,
			hasOwner: true,
		});
		for (const owner of owners) {
			expect({ path, owner }).toEqual({
				path,
				owner: expect.stringMatching(/^@[\w-]+(\/[\w-]+)?$/),
			});
		}
	}
});

/** Turn a CODEOWNERS pattern into a test for a repository-relative file path. */
function matcher(pattern: string): (file: string) => boolean {
	const anchored =
		pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
	const directory = pattern.endsWith("/");
	const body = pattern
		.replace(/^\//, "")
		.replace(/\/$/, "")
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "\u0000")
		.replace(/\*/g, "[^/]*")
		.replace(/\?/g, "[^/]")
		.replaceAll("\u0000", ".*");
	const prefix = anchored ? "^" : "^(?:.*/)?";
	// A directory pattern owns everything below it; a file pattern also
	// matches a directory of that name and what is inside it.
	const suffix = directory ? "/.*$" : "(?:/.*)?$";
	const expression = new RegExp(prefix + body + suffix);
	return (file) => expression.test(file);
}

test("no later CODEOWNERS rule takes a protected file away from its entry", async () => {
	// GitHub uses the LAST matching rule, so a `*` line added at the end would
	// replace or clear the owners of everything above it.
	const rules = [...(await entries()).keys()];
	for (const [file, entry] of [
		[".github/workflows/ci.yml", "/.github/workflows/"],
		[".github/CODEOWNERS", "/.github/CODEOWNERS"],
		["tests/gate/ci.test.ts", "/tests/gate/"],
		["justfile", "/justfile"],
		["lefthook.yml", "/lefthook.yml"],
		[".lefthook/rc.sh", "/.lefthook/"],
		[".lefthook/pre-push/check.sh", "/.lefthook/"],
		["tests/toolchain/helpers.ts", "/tests/toolchain/"],
	] as const) {
		const last = rules.filter((rule) => matcher(rule)(file)).at(-1);
		expect({ file, decidedBy: last }).toEqual({ file, decidedBy: entry });
	}
});
