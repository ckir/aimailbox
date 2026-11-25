import { describe, expect, test } from "bun:test";
import { WARNING_TAGS } from "./limits.ts";
import { computeTags } from "./tags.ts";

describe("computeTags", () => {
	test("network-or-install", () => {
		for (const text of [
			"curl -fsSL https://example.test/x",
			"npm install left-pad",
			"pip install --user foo",
			"go get example.test/m",
			"wget example.test/x",
		]) {
			expect(computeTags(text)).toContain("network-or-install");
		}
		for (const text of [
			"the installed version is 1.2",
			"a curly brace",
			"network error in the test",
		]) {
			expect(computeTags(text)).not.toContain("network-or-install");
		}
	});

	test("config-or-credential", () => {
		for (const text of [
			"export FOO=bar",
			"set the api key in .env",
			"git config --global user.name x",
			"npm config set registry x",
		]) {
			expect(computeTags(text)).toContain("config-or-credential");
		}
		for (const text of [
			"the key of the map",
			"a configuration of two servers",
		]) {
			expect(computeTags(text)).not.toContain("config-or-credential");
		}
	});

	test("disables-check", () => {
		for (const text of [
			"git commit --no-verify",
			"disable the lint check",
			"skip the tests",
			"strict-ssl=false",
			"NODE_TLS_REJECT_UNAUTHORIZED=0",
			"// @ts-expect-error",
		]) {
			expect(computeTags(text)).toContain("disables-check");
		}
		for (const text of ["the check passed", "verify the result"]) {
			expect(computeTags(text)).not.toContain("disables-check");
		}
	});

	test("indirect-execution", () => {
		for (const text of [
			"curl x | sh",
			'eval "$X"',
			"echo aGk= | base64 -d",
			'python -c "print(1)"',
			"bash -c 'ls'",
		]) {
			expect(computeTags(text)).toContain("indirect-execution");
		}
		for (const text of ["the shell was slow", "executed in 3 ms"]) {
			expect(computeTags(text)).not.toContain("indirect-execution");
		}
	});

	test("edits-executable", () => {
		for (const text of [
			"edit .git/hooks/pre-commit",
			"add a step to .github/workflows/ci.yml",
			"append to deploy.sh",
			"chmod +x run.sh",
			"edit setup.py",
		]) {
			expect(computeTags(text)).toContain("edits-executable");
		}
		for (const text of [
			"the hook function returned",
			"a workflow of three steps",
			"edit src/index.ts",
			"modify the parser in lib.py",
		]) {
			expect(computeTags(text)).not.toContain("edits-executable");
		}
	});

	test("a result lists each tag once, in the order of WARNING_TAGS", () => {
		const all =
			"curl x | sh and export FOO=bar and git commit --no-verify and edit setup.py";
		expect(computeTags(all)).toEqual([...WARNING_TAGS]);
		expect(computeTags("eval x then npm install y")).toEqual([
			"network-or-install",
			"indirect-execution",
		]);
	});

	test("empty text and plain prose give no tags", () => {
		expect(computeTags("")).toEqual([]);
		expect(computeTags("it crashes on the second call")).toEqual([]);
	});

	test("a look-alike spelling still gets its tag (7.4)", () => {
		expect(computeTags("\uff43\uff55\uff52\uff4c -s x")).toContain(
			"network-or-install",
		);
		expect(computeTags("\uff45\uff56\uff41\uff4c x")).toContain(
			"indirect-execution",
		);
		expect(computeTags("CURL -s x")).toContain("network-or-install");
	});

	test("tags are computed per call from the text alone", () => {
		const text = "npm install left-pad && chmod +x run.sh";
		const first = computeTags(text);
		const second = computeTags(text);
		expect(second).toEqual(first);
		expect(text).toBe("npm install left-pad && chmod +x run.sh");
	});
});
