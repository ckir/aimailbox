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
