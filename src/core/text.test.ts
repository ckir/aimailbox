import { expect, test } from "bun:test";
import {
	codePointLength,
	cutToBytes,
	cutToCodePoints,
	isConforming,
	normalizeLineEnds,
	stripForbidden,
	utf8Length,
} from "./text.ts";

test("each line-end form becomes one line feed", () => {
	expect(normalizeLineEnds("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
	expect(normalizeLineEnds("a\r\r\nb")).toBe("a\n\nb");
});
test("each forbidden category is removed, newline and tab are kept", () => {
	expect(stripForbidden("a\u0000b")).toBe("ab"); // Cc
	expect(stripForbidden("a\u001b[31mb")).toBe("a[31mb"); // Cc: escape
	expect(stripForbidden("a\u200bb\u202eb")).toBe("abb"); // Cf: zero width, bidi override
	expect(stripForbidden("a\ud800b")).toBe("ab"); // Cs: lone surrogate
	expect(stripForbidden("a\ue000b")).toBe("ab"); // Co
	expect(stripForbidden("a\u0378b")).toBe("ab"); // Cn
	expect(stripForbidden("a\u2028b\u2029c")).toBe("abc"); // Zl, Zp
	expect(stripForbidden("a\tb\nc")).toBe("a\tb\nc");
	expect(stripForbidden("a\r\nb")).toBe("a\nb");
});
test("each default-ignorable code point that the categories leave in is removed", () => {
	const units = [
		"\u034f",
		"\u115f",
		"\u1160",
		"\u17b4",
		"\u180b",
		"\u3164",
		"\ufe00",
		"\ufe0e",
		"\ufe0f",
		"\uffa0",
		"\u{e0100}",
		"\u{e01ef}",
	];
	for (const unit of units) {
		expect(stripForbidden(`a${unit}b`)).toBe("ab");
		expect(isConforming(`a${unit}b`)).toBe(false);
	}
});
test("the emoji presentation selectors go, the emoji stays", () => {
	expect(stripForbidden("\u2764\ufe0f")).toBe("\u2764");
	expect(stripForbidden("\u{1f600}")).toBe("\u{1f600}");
});
test("a visible look-alike filler-free word is untouched", () => {
	expect(stripForbidden("caf\u00e9 \u4e2d\u6587 ok")).toBe(
		"caf\u00e9 \u4e2d\u6587 ok",
	);
});
test("a Hangul filler splits nothing after removal", () => {
	expect(stripForbidden("ab\u3164cd")).toBe("abcd");
});
test("a lone carriage return becomes a line feed before anything is removed", () => {
	expect(stripForbidden("a\u000db")).toBe("a\u000ab");
	expect(stripForbidden("a\u000d\u000d\u000ab")).toBe("a\u000a\u000ab");
});
test("an astral character is kept and text is not normalised", () => {
	expect(stripForbidden("ok 😀")).toBe("ok 😀");
	expect(stripForbidden("e\u0301")).toBe("e\u0301");
	expect(stripForbidden("\ufb01")).toBe("\ufb01");
});
test("isConforming is false for a carriage return and for a forbidden character", () => {
	expect(isConforming("a\rb")).toBe(false);
	expect(isConforming("a\u200bb")).toBe(false);
	expect(isConforming("a\tb\nc é 😀")).toBe(true);
});
test("lengths and cuts count the right unit and never split a code point", () => {
	expect(utf8Length("é😀")).toBe(6);
	expect(codePointLength("é😀")).toBe(2);
	expect(cutToBytes("aé😀", 2)).toBe("a"); // é needs bytes 2..3
	expect(cutToBytes("aé😀", 3)).toBe("aé");
	expect(cutToBytes("aé😀", 6)).toBe("aé"); // 😀 needs 4 more
	expect(cutToBytes("aé😀", 7)).toBe("aé😀");
	expect(cutToCodePoints("a😀b", 2)).toBe("a😀");
	expect(cutToBytes("abc", 0)).toBe("");
});

test("cuts fail closed on NaN and on limits below one, and round fractions down", () => {
	expect(cutToCodePoints("abcdef", Number.NaN)).toBe("");
	expect(cutToCodePoints("abcdef", -1)).toBe("");
	expect(cutToCodePoints("abcdef", 0)).toBe("");
	expect(cutToCodePoints("abcdef", 0.5)).toBe("");
	expect(cutToCodePoints("abcdef", 1.5)).toBe("a");
	expect(cutToCodePoints("abcdef", 2.9)).toBe("ab");
	expect(cutToCodePoints("abcdef", Number.POSITIVE_INFINITY)).toBe("abcdef");
	expect(cutToCodePoints("abcdef", Number.NEGATIVE_INFINITY)).toBe("");
	expect(cutToBytes("abcdef", Number.NaN)).toBe("");
	expect(cutToBytes("abcdef", -1)).toBe("");
	expect(cutToBytes("abcdef", 0.5)).toBe("");
	expect(cutToBytes("abcdef", 1.5)).toBe("a");
	expect(cutToBytes("abcdef", 3.9)).toBe("abc");
	expect(cutToBytes("abcdef", Number.POSITIVE_INFINITY)).toBe("abcdef");
	expect(cutToBytes("abcdef", Number.NEGATIVE_INFINITY)).toBe("");
});
test("a fractional byte limit never splits a character", () => {
	expect(cutToBytes("éa", 2.9)).toBe("é"); // two bytes fit, the third does not
	expect(cutToBytes("éa", 1.9)).toBe("");
});
