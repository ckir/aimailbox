import { expect, test } from "bun:test";
import {
	canOrder,
	compareVersions,
	isValidVersion,
	resolveInstalled,
	rowKey,
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
