import { expect, test } from "bun:test";
import {
	canonicalise,
	ecosystemOf,
	formatNoteId,
	isCanonical,
	parseNoteId,
} from "./address.ts";

const ok = (input: string, out: string) =>
	expect<unknown>(canonicalise(input)).toEqual({ ok: true, value: out });
const bad = (input: string, error = "bad-name") =>
	expect<unknown>(canonicalise(input)).toEqual({ ok: false, error });

test("prefixes are a closed lowercase list", () => {
	bad("gem/rails", "unknown-prefix");
	bad("NPM/left-pad", "unknown-prefix");
	bad("left-pad", "unknown-prefix");
	bad("", "unknown-prefix");
	bad(`npm/${"a".repeat(1100)}`, "too-long");
});
test("the length checks: raw input first, the result last", () => {
	bad(`gem/${"a".repeat(1100)}`, "too-long");
	bad(`pypi/${"a".repeat(300)}`, "too-long");
	ok(`pypi/${"a".repeat(251)}`, `pypi/${"a".repeat(251)}`); // 5 + 251 = 256 bytes
	bad(`pypi/${"a".repeat(252)}`, "too-long");
});
test("npm keeps case, so MEAN and mean are two boxes", () => {
	ok("npm/MEAN", "npm/MEAN");
	ok("npm/mean", "npm/mean");
	ok("npm/@biomejs/biome", "npm/@biomejs/biome");
	ok("npm/@Scope/Pkg.js", "npm/@Scope/Pkg.js");
	ok("npm/a~b", "npm/a~b");
});
test("npm refuses what the registry's validator refuses, and the legacy characters", () => {
	for (const name of [
		"",
		".hidden",
		"-x",
		"_x",
		"@scope/.x",
		"@/x",
		"@scope/",
		"@scope",
		"a/b",
		"@a/b/c",
		"a b",
		"a!",
		"it's",
		"f(x)",
		"a*",
		"café",
		"node_modules",
		"Node_Modules",
		"favicon.ico",
		"a".repeat(215),
	])
		bad(`npm/${name}`);
	ok(`npm/${"a".repeat(214)}`, `npm/${"a".repeat(214)}`);
	ok("npm/@scope/-x", "npm/@scope/-x"); // the validator checks a leading - and _ on the whole name only
});
test("pypi is lowercased and runs of - _ . become one -", () => {
	ok("pypi/Friendly-Bard", "pypi/friendly-bard");
	ok("pypi/FRIENDLY.bard", "pypi/friendly-bard");
	ok("pypi/friendly__--..bard", "pypi/friendly-bard");
	ok("pypi/a", "pypi/a");
	for (const name of ["", "-a", "a-", ".a", "a_", "a b", "\u017fix", "a/b"])
		bad(`pypi/${name}`);
});
test("cargo is lowercased and _ becomes -", () => {
	ok("cargo/Serde_JSON", "cargo/serde-json");
	ok("cargo/a", "cargo/a");
	ok(`cargo/${"a".repeat(64)}`, `cargo/${"a".repeat(64)}`);
	for (const name of [
		"",
		"1abc",
		"_abc",
		"-abc",
		"a.b",
		"a b",
		"é",
		"a".repeat(65),
	])
		bad(`cargo/${name}`);
});
test("a canonical address stays the same, and isCanonical says so", () => {
	for (const input of [
		"npm/MEAN",
		"npm/@a/b",
		"pypi/Friendly.Bard",
		"cargo/Serde_JSON",
	]) {
		const once = canonicalise(input);
		if (!once.ok) throw new Error(input);
		expect<unknown>(canonicalise(once.value)).toEqual(once);
		expect(isCanonical(once.value)).toBe(true);
	}
	expect(isCanonical("pypi/Friendly.Bard")).toBe(false);
	expect(isCanonical("cargo/serde_json")).toBe(false);
	expect(ecosystemOf("npm/@a/b")).toBe("npm");
	expect(() => ecosystemOf("cargo/serde_json")).toThrow();
});
test("formatNoteId refuses a number that is not a positive safe integer", () => {
	for (const n of [0, -1, 1.5, 2 ** 53, Number.NaN])
		expect(() => formatNoteId("npm/a", n)).toThrow();
	expect(formatNoteId("npm/a", 2 ** 53 - 1)).toBe("npm/a#9007199254740991");
});
test("note identifiers", () => {
	expect(formatNoteId("npm/@a/b", 41)).toBe("npm/@a/b#41");
	expect<unknown>(parseNoteId("npm/@a/b#41")).toEqual({
		ok: true,
		value: { address: "npm/@a/b", noteNumber: 41 },
	});
	for (const id of [
		"npm/@a/b",
		"npm/@a/b#",
		"npm/@a/b#0",
		"npm/@a/b#041",
		"npm/@a/b#-1",
		"npm/@a/b#1.5",
		"npm/@a/b#99999999999999999999",
		"cargo/serde_json#1",
		"npm/a#1#2",
	])
		expect<unknown>(parseNoteId(id)).toEqual({
			ok: false,
			error: "bad-note-id",
		});
	expect(() => formatNoteId("cargo/serde_json", 1)).toThrow();
	expect(() => formatNoteId("npm/a", 0)).toThrow();
});
