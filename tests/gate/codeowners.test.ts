/**
 * Pins the CODEOWNERS entries that route changes to the CI workflow, and to
 * the tests guarding it, to the owner. Like the workflow tests, this reads a
 * file; whether GitHub enforces it depends on branch protection.
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

test("the CI workflow, its tests and CODEOWNERS itself each have an owner", async () => {
	const owned = await entries();
	for (const path of [
		"/.github/workflows/",
		"/.github/CODEOWNERS",
		"/tests/gate/",
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
