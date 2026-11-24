import { expect, test } from "bun:test";
import {
	canOrder,
	compareVersions,
	isValidVersion,
	resolveInstalled,
	rowKey,
	rowVersion,
	stripLeadingV,
	versionsEqual,
} from "./version.ts";

test("the version charset and length", () => {
	expect(isValidVersion("1.2.3")).toBe(true);
	expect(isValidVersion("1!2.0~rc1+local_x:y")).toBe(true);
	expect(isValidVersion("")).toBe(false);
	expect(isValidVersion("1.2 3")).toBe(false);
	expect(isValidVersion("1.2/3")).toBe(false);
	expect(isValidVersion("1.2é")).toBe(false);
	expect(isValidVersion("1".repeat(64))).toBe(true);
	expect(isValidVersion("1".repeat(65))).toBe(false);
});
test("one leading v is removed, not two", () => {
	expect(stripLeadingV("v1.2.3")).toBe("1.2.3");
	expect(stripLeadingV("vv1")).toBe("v1");
	expect(stripLeadingV("1.2.3")).toBe("1.2.3");
});
test("only strict SemVer in npm, cargo and go can be ordered", () => {
	for (const ok of [
		"1.2.3",
		"v1.2.3",
		"0.0.0",
		"1.0.0-alpha.1",
		"1.0.0-0.3.7",
		"1.0.0+20130313144700",
		"1.0.0-beta+exp.sha.5114f85",
		"1.0.0--",
	])
		expect(canOrder("npm", ok)).toBe(true);
	for (const bad of [
		"1.2",
		"1",
		"01.2.3",
		"1.02.3",
		"1.2.3-",
		"1.2.3-01",
		"1.2.3-a..b",
		"1.2.3+",
		"1.2.3+a..b",
		"latest",
		"1.2.3.4",
		"vv1.2.3",
		"1.2.3 ",
		"1!1.2.3",
	])
		expect(canOrder("npm", bad)).toBe(false);
	expect(canOrder("cargo", "1.2.3")).toBe(true);
	expect(canOrder("go", "v1.2.3")).toBe(true);
	expect(canOrder("pypi", "1.2.3")).toBe(false);
	expect(canOrder("tool", "1.2.3")).toBe(false);
});
test("a version too long for 12.1 is never ordered", () => {
	expect(canOrder("npm", `1.0.0-${"a".repeat(58)}`)).toBe(true); // 64 characters
	expect(canOrder("npm", `1.0.0-${"a".repeat(59)}`)).toBe(false);
});
test("precedence follows Semantic Versioning 2.0.0", () => {
	const chain = [
		"1.0.0-alpha",
		"1.0.0-alpha.1",
		"1.0.0-alpha.beta",
		"1.0.0-beta",
		"1.0.0-beta.2",
		"1.0.0-beta.11",
		"1.0.0-rc.1",
		"1.0.0",
		"2.0.0",
		"2.1.0",
		"2.1.1",
	];
	for (let i = 0; i + 1 < chain.length; i++) {
		expect(
			compareVersions("npm", chain[i] as string, chain[i + 1] as string),
		).toBe(-1);
		expect(
			compareVersions("npm", chain[i + 1] as string, chain[i] as string),
		).toBe(1);
	}
	expect(compareVersions("npm", "1.10.0", "1.9.0")).toBe(1);
	expect(compareVersions("npm", "1.0.0-1", "1.0.0-a")).toBe(-1);
	expect(
		compareVersions(
			"npm",
			"99999999999999999999.0.0",
			"100000000000000000000.0.0",
		),
	).toBe(-1);
});
test("non-numeric identifiers compare in ASCII order and long numeric ones exactly", () => {
	expect(compareVersions("npm", "1.0.0-Z", "1.0.0-a")).toBe(-1);
	expect(compareVersions("npm", "1.0.0-a-", "1.0.0-a0")).toBe(-1);
	expect(
		compareVersions(
			"npm",
			"1.0.0-99999999999999999999",
			"1.0.0-100000000000000000000",
		),
	).toBe(-1);
});
test("v1.2.3 equals 1.2.3 and orders; build metadata is ignored", () => {
	expect(compareVersions("go", "v1.2.3", "1.2.3")).toBe(0);
	expect(compareVersions("npm", "1.2.3+a", "1.2.3+b")).toBe(0);
	expect(versionsEqual("npm", "v1.2.3+a", "1.2.3")).toBe(true);
	expect(compareVersions("npm", "1.2", "1.2.0")).toBeUndefined();
	expect(compareVersions("pypi", "1.2.3", "1.2.4")).toBeUndefined();
});
test("the two pairs of spec section 4 are not comparable", () => {
	expect(compareVersions("pypi", "1.0.post1", "1.0.1")).toBeUndefined();
	expect(compareVersions("npm", "1.0.post1", "1.0.1")).toBeUndefined();
	expect(compareVersions("tool", "2:1.0-1", "1:2.0-1")).toBeUndefined();
	expect(compareVersions("npm", "2:1.0-1", "1:2.0-1")).toBeUndefined();
});
test("where versions cannot be ordered, equality is on the whole string after one v", () => {
	expect(versionsEqual("pypi", "v1.2.3", "1.2.3")).toBe(true);
	expect(versionsEqual("pypi", "1.2.3+a", "1.2.3")).toBe(false);
	expect(versionsEqual("npm", "1.2", "1.2.0")).toBe(false);
	expect(versionsEqual("npm", "latest", "vlatest")).toBe(true);
});
test("the row key drops one v, and the build part only where versions order", () => {
	expect(rowKey("npm", "v1.2.0+a")).toBe("1.2.0");
	expect(rowKey("npm", "1.0.0-rc.1+x")).toBe("1.0.0-rc.1");
	expect(rowKey("pypi", "v1.2.0+a")).toBe("1.2.0+a");
	expect(rowKey("npm", "v1.2+a")).toBe("1.2+a");
});
test("the installed version", () => {
	expect<unknown>(resolveInstalled("npm", "1.2.3", ["9.9.9"])).toEqual({
		ok: true,
		value: "1.2.3",
	});
	expect<unknown>(resolveInstalled("npm", "1.2 3", [])).toEqual({
		ok: false,
		error: "invalid-version",
	});
	expect<unknown>(resolveInstalled("npm", undefined, ["1.2.3"])).toEqual({
		ok: true,
		value: "1.2.3",
	});
	expect<unknown>(
		resolveInstalled("npm", undefined, ["1.2.3", "v1.2.3+b"]),
	).toEqual({
		ok: true,
		value: "1.2.3",
	});
	expect<unknown>(
		resolveInstalled("npm", undefined, ["1.2.3", "1.2.4"]),
	).toEqual({
		ok: true,
		value: undefined,
	});
	expect<unknown>(resolveInstalled("npm", undefined, [])).toEqual({
		ok: true,
		value: undefined,
	});
	expect<unknown>(
		resolveInstalled("npm", undefined, ["1.2.3", "bad version"]),
	).toEqual({
		ok: true,
		value: undefined,
	});
	expect<unknown>(resolveInstalled("tool", undefined, ["1.2.3"])).toEqual({
		ok: true,
		value: undefined,
	});
	expect<unknown>(resolveInstalled("tool", "2024-01", [])).toEqual({
		ok: true,
		value: "2024-01",
	});
});

const ROW_VERSIONS = [
	"v",
	"vv1.2.3",
	"v1.2.3",
	"1.2.3",
	"1.2.3+b",
	"v1.2.3+b",
	"vvfoo",
	"vfoo",
	"foo",
	"vvx",
	"vx",
	"vv1",
	"v1",
	"vvv",
	"1.0.0-rc.1",
];
const FIVE = ["npm", "cargo", "go", "pypi", "tool"] as const;

test("a row's version is its key when the key is a valid version that rowKey leaves unchanged, else the version as written", () => {
	expect(rowVersion("npm", "v1.2.0+a")).toBe("1.2.0");
	expect(rowVersion("pypi", "v1.2.0+a")).toBe("1.2.0+a");
	expect(rowVersion("npm", "v")).toBe("v");
	expect(rowVersion("pypi", "vv1.2.3")).toBe("vv1.2.3"); // key "v1.2.3" is not stable
	expect(rowVersion("npm", "vv1.2.3")).toBe("vv1.2.3");
	expect(rowVersion("tool", "vvx")).toBe("vvx");
	expect(rowVersion("cargo", "vv1")).toBe("vv1");
});
test("a row's version is a valid version, stable under rowKey, and rowVersion is idempotent", () => {
	for (const e of FIVE) {
		for (const v of ROW_VERSIONS) {
			const r = rowVersion(e, v);
			expect(isValidVersion(r)).toBe(true);
			expect(rowVersion(e, r)).toBe(r);
		}
	}
});
test("versions with equal row versions have equal row keys", () => {
	for (const e of FIVE) {
		for (const a of ROW_VERSIONS) {
			for (const b of ROW_VERSIONS) {
				if (rowVersion(e, a) === rowVersion(e, b)) {
					expect(rowKey(e, a)).toBe(rowKey(e, b));
				}
				if (rowKey(e, a) !== rowKey(e, b)) {
					expect(rowVersion(e, a)).not.toBe(rowVersion(e, b));
				}
			}
		}
	}
});

test("versionsEqual is false for versions that are not valid, even where the text is equal", () => {
	expect(versionsEqual("npm", "v", "")).toBe(false);
	expect(versionsEqual("npm", "", "")).toBe(false);
	expect(versionsEqual("npm", "v", "v")).toBe(true); // both valid: unchanged
	expect(versionsEqual("tool", "v", "")).toBe(false);
	expect(versionsEqual("go", "v", "")).toBe(false);
	expect(versionsEqual("tool", "v1", "1")).toBe(true); // valid, unorderable: unchanged
	expect(versionsEqual("tool", "abc", "abc")).toBe(true);
});

test("versionsEqual is false for each invalid pair, even where the text is equal", () => {
	const sixtyFour = "1".repeat(64);
	for (const ecosystem of ["npm", "tool"] as const) {
		expect(versionsEqual(ecosystem, "1.2 3", "1.2 3")).toBe(false);
		expect(versionsEqual(ecosystem, "1".repeat(65), "1".repeat(65))).toBe(
			false,
		);
		expect(versionsEqual(ecosystem, sixtyFour, `v${sixtyFour}`)).toBe(false); // a valid version against its invalid twin
		expect(versionsEqual(ecosystem, `v${sixtyFour}`, sixtyFour)).toBe(false);
		expect(versionsEqual(ecosystem, "", "v")).toBe(false);
		expect(versionsEqual(ecosystem, "v", "")).toBe(false);
	}
	expect(versionsEqual("npm", sixtyFour, sixtyFour)).toBe(true);
});
test("versionsEqual is true for a valid pair that cannot be ordered", () => {
	expect(versionsEqual("pypi", "2024.1", "v2024.1")).toBe(true);
	expect(versionsEqual("tool", "nightly", "vnightly")).toBe(true);
	expect(versionsEqual("go", "latest", "latest")).toBe(true);
	expect(versionsEqual("npm", "1.2", "v1.2")).toBe(true);
});
test("rowVersion does not repair an invalid version", () => {
	const sixtyFiveInvalid = `v1.0.0-${"a".repeat(58)}`; // "v" plus 64 valid characters
	expect(sixtyFiveInvalid.length).toBe(65);
	expect(isValidVersion(sixtyFiveInvalid)).toBe(false);
	expect(rowVersion("npm", sixtyFiveInvalid)).toBe(sixtyFiveInvalid);
	expect(rowVersion("tool", `v${"1".repeat(64)}`)).toBe(`v${"1".repeat(64)}`);
	expect(rowVersion("npm", "1.2 3")).toBe("1.2 3");
	expect(rowVersion("npm", "")).toBe("");
	expect(rowVersion("npm", `v1.0.0-${"a".repeat(57)}`)).toBe(
		`1.0.0-${"a".repeat(57)}`,
	); // 64 characters, valid: the leading v is still removed
});

test("resolveInstalled stops at the second group: many distinct versions give undefined, equal ones the first member", () => {
	const distinct = Array.from({ length: 50 }, (_, i) => `1.0.${i}`);
	let reads = 0;
	const counted = new Proxy(distinct, {
		get(target, key, receiver) {
			if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
			return Reflect.get(target, key, receiver);
		},
	});
	expect<unknown>(resolveInstalled("npm", undefined, counted)).toEqual({
		ok: true,
		value: undefined,
	});
	// One validity pass over all 50 elements, then the first two reads of the
	// loop: the loop stops at the second group instead of reading to the end.
	expect(reads).toBeLessThanOrEqual(distinct.length + 2);
	expect<unknown>(
		resolveInstalled("npm", undefined, [
			"v1.2.3",
			"1.2.3",
			"1.2.3+b",
			"v1.2.3",
		]),
	).toEqual({ ok: true, value: "v1.2.3" });
	expect<unknown>(
		resolveInstalled("npm", undefined, ["1.2.3", "v1.2.3", "1.2.4"]),
	).toEqual({ ok: true, value: undefined });
	expect<unknown>(resolveInstalled("npm", undefined, ["1.2.3"])).toEqual({
		ok: true,
		value: "1.2.3",
	});
	expect<unknown>(resolveInstalled("npm", undefined, [])).toEqual({
		ok: true,
		value: undefined,
	});
});
