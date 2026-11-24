import { expect, test } from "bun:test";
import { CASE_FOLDING, CASE_FOLDING_UNICODE_VERSION } from "./casefold-data.ts";
import { countMatches, foldText, queryWords, wordsOf } from "./fold.ts";

test("the table is the Unicode 17.0.0 C and F mappings", () => {
	expect(CASE_FOLDING_UNICODE_VERSION).toBe("17.0.0");
	expect(CASE_FOLDING.size).toBe(1585); // 1481 C + 104 F
	expect(CASE_FOLDING.get(0xdf)).toBe("ss");
	expect(CASE_FOLDING.get(0x130)).toBe("i\u0307");
	expect(CASE_FOLDING.get(0x212a)).toBe("k");
});
test("the runtime's Unicode version matches the table", () => {
	// Fails when Bun moves to a newer Unicode: regenerate the table from that version's file.
	expect(
		CASE_FOLDING_UNICODE_VERSION.startsWith(`${process.versions.unicode}.`),
	).toBe(true);
});
test("a look-alike spelling folds to the plain one", () => {
	expect(foldText("CURL")).toBe("curl");
	expect(foldText("\uff43\uff55\uff52\uff4c")).toBe("curl"); // full-width
	expect(foldText("\ufb01le")).toBe("file"); // ligature
	expect(foldText("Straße")).toBe("strasse");
	expect(foldText("\u017fudo")).toBe("sudo"); // long s
	expect(foldText("\u0390")).toBe(foldText("\u0399\u0308\u0301")); // needs the second NFKC
});
test("words split on anything that is not a letter or decimal digit", () => {
	expect(wordsOf("npm install --save foo_bar2")).toEqual([
		"npm",
		"install",
		"save",
		"foo",
		"bar2",
	]);
	expect(wordsOf("  ")).toEqual([]);
	expect(wordsOf("Crème brûlée")).toEqual(["crème", "brûlée"]);
});
test("query words are unique, in first-appearance order, at most eight", () => {
	expect(queryWords("Lock LOCK file")).toEqual(["lock", "file"]);
	expect(queryWords("a b c d e f g h i j")).toEqual([
		"a",
		"b",
		"c",
		"d",
		"e",
		"f",
		"g",
		"h",
	]);
});
test("duplicates are removed before the first eight are taken", () => {
	expect(queryWords("a a b c d e f g h i")).toEqual([
		"a",
		"b",
		"c",
		"d",
		"e",
		"f",
		"g",
		"h",
	]);
});
test("matching is on whole words and counts distinct query words", () => {
	expect(countMatches(["lock", "file"], "Lockfile and a LOCK")).toBe(1);
	expect(countMatches(["lock", "file"], "the lock file, the lock")).toBe(2);
	expect(countMatches([], "anything")).toBe(0);
});

test("countMatches folds the given words again, so raw and folded words match alike", () => {
	expect(countMatches(["LOCK"], "LOCK")).toBe(1);
	expect(countMatches(["Lock"], "the lock file")).toBe(1);
	expect(countMatches(["Straße"], "strasse")).toBe(1);
	expect(countMatches(["LOCK", "lock", "Lock"], "lock")).toBe(1); // distinct after folding
	expect(countMatches(["lock", "file", "other"], "the lock file")).toBe(2);
	expect(countMatches(queryWords("Lock FILE"), "the lock file")).toBe(2);
});
