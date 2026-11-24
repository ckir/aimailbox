import { expect, test } from "bun:test";
import type { Ecosystem } from "./ecosystem.ts";
import { T0, workedEntry } from "./fixtures.ts";
import { deriveStatus, type Vote } from "./status.ts";

const c = (version: string | undefined, t: number, isBurst = false): Vote => ({
	form: "confirm",
	version,
	arrivalTime: T0 + t,
	isBurst,
});
const d = (version: string | undefined, t: number, isBurst = false): Vote => ({
	form: "doesNotReproduce",
	version,
	arrivalTime: T0 + t,
	isBurst,
});

const workedVotes = [
	c("1.2.0", 100),
	c("v1.2.0", 200),
	c("1.2.1", 300),
	c("1.2.1+build", 500),
	d("1.3.0", 400),
	d("1.3.0", 450),
	d("v1.3.0", 600),
];

test("the worked entry's status data comes out of its votes, in any order", () => {
	const want = {
		confirm: workedEntry.confirm,
		doesNotReproduce: workedEntry.doesNotReproduce,
		rows: workedEntry.rows,
		highestConfirmedVersion: "1.2.1",
	};
	expect(deriveStatus("npm", workedVotes)).toEqual(want);
	expect(deriveStatus("npm", [...workedVotes].reverse())).toEqual(want);
});
test("no votes", () => {
	expect(deriveStatus("npm", [])).toEqual({
		confirm: { total: 0, nonBurstTotal: 0, burst: false },
		doesNotReproduce: { total: 0, nonBurstTotal: 0, burst: false },
		rows: [],
	});
});
test("a vote without a version counts in the totals and in no row", () => {
	const s = deriveStatus("npm", [c(undefined, 100), c("1.0.0", 50)]);
	expect(s.confirm).toEqual({
		total: 2,
		nonBurstTotal: 2,
		burst: false,
		lastNonBurstTime: T0 + 100,
	});
	expect(s.rows.map((r) => r.version)).toEqual(["1.0.0"]);
});
test("burst arrivals are in the totals only; they move neither the last time nor the highest confirmed version", () => {
	const s = deriveStatus("npm", [
		c("1.0.0", 100),
		c("9.0.0", 900, true),
		c("9.0.0", 901, true),
	]);
	expect(s.confirm).toEqual({
		total: 3,
		nonBurstTotal: 1,
		burst: true,
		lastNonBurstTime: T0 + 100,
	});
	expect(s.highestConfirmedVersion).toBe("1.0.0");
	expect(s.rows).toEqual([
		{
			version: "1.0.0",
			confirmTotal: 1,
			confirmNonBurst: 1,
			doesNotReproduceTotal: 0,
			doesNotReproduceNonBurst: 0,
		},
		{
			version: "9.0.0",
			confirmTotal: 2,
			confirmNonBurst: 0,
			doesNotReproduceTotal: 0,
			doesNotReproduceNonBurst: 0,
		},
	]);
	expect(deriveStatus("npm", [c("1.0.0", 1, true)]).confirm).toEqual({
		total: 1,
		nonBurstTotal: 0,
		burst: true,
	});
});
test("where versions never order there is no highest confirmed version and rows keep the build part", () => {
	const s = deriveStatus("pypi", [c("1.0+a", 1), c("v1.0+a", 2), c("1.0", 3)]);
	expect(s.highestConfirmedVersion).toBeUndefined();
	expect(s.rows.map((r) => [r.version, r.confirmTotal])).toEqual([
		["1.0", 1],
		["1.0+a", 2],
	]);
});
test("rows are dropped in the stated order and totals keep their counts", () => {
	// two unorderable rows and three orderable ones
	const votes = [
		c("nightly", 500),
		c("latest", 100),
		c("1.0.0", 900),
		c("2.0.0", 10),
		c("3.0.0", 20),
	];
	expect(deriveStatus("npm", votes, 4).rows.map((r) => r.version)).toEqual([
		"1.0.0",
		"2.0.0",
		"3.0.0",
		"nightly",
	]); // "latest" is least recent
	expect(deriveStatus("npm", votes, 3).rows.map((r) => r.version)).toEqual([
		"1.0.0",
		"2.0.0",
		"3.0.0",
	]);
	expect(deriveStatus("npm", votes, 2).rows.map((r) => r.version)).toEqual([
		"2.0.0",
		"3.0.0",
	]); // oldest version first, whatever its time
	expect(deriveStatus("npm", votes, 2).confirm.total).toBe(5);
	expect(deriveStatus("npm", votes, 2).highestConfirmedVersion).toBe("3.0.0");
});
test("the row bound must be a positive integer", () => {
	for (const n of [0, -1, 1.5, Number.NaN])
		expect(() => deriveStatus("npm", [], n)).toThrow(RangeError);
});
test("a dropped row's version can still be the highest confirmed version", () => {
	const votes = [c("5.0.0", 1), d("6.0.0", 2), d("7.0.0", 3)];
	const s = deriveStatus("npm", votes, 2);
	expect(s.rows.map((r) => r.version)).toEqual(["6.0.0", "7.0.0"]);
	expect(s.highestConfirmedVersion).toBe("5.0.0");
});
test("unorderable rows that tie on time drop the lower key first", () => {
	const votes = [c("beta", 100), c("alpha", 100), c("gamma", 100)];
	expect(deriveStatus("npm", votes, 2).rows.map((r) => r.version)).toEqual([
		"beta",
		"gamma",
	]);
	expect(deriveStatus("tool", votes, 1).rows.map((r) => r.version)).toEqual([
		"gamma",
	]);
});
test("how recent an unorderable row is counts burst votes too", () => {
	const votes = [c("aaa", 10), c("aaa", 900, true), c("bbb", 500)];
	expect(deriveStatus("tool", votes, 1).rows.map((r) => r.version)).toEqual([
		"aaa",
	]);
});
test("the default bound is sixteen rows", () => {
	const votes = Array.from({ length: 20 }, (_, i) => c(`1.0.${i}`, i));
	const s = deriveStatus("npm", votes);
	expect(s.rows.length).toBe(16);
	expect(s.rows[0]?.version).toBe("1.0.4");
});

test("a row's version is valid and stable, whatever leading v the vote carries", () => {
	const rowsOf = (eco: Ecosystem, versions: string[]) =>
		deriveStatus(
			eco,
			versions.map((v, i) => c(v, i)),
		).rows.map((r) => r.version);
	expect(rowsOf("npm", ["v", "vv1.2.3", "v1.2.3", "1.2.3"])).toEqual([
		"1.2.3",
		"v",
		"vv1.2.3",
	]);
	const npm = deriveStatus("npm", [
		c("v1.2.3", 1),
		c("1.2.3", 2),
		c("vv1.2.3", 3),
	]);
	expect(npm.rows.map((r) => [r.version, r.confirmTotal])).toEqual([
		["1.2.3", 2],
		["vv1.2.3", 1],
	]);
	expect(rowsOf("pypi", ["vvfoo", "vfoo", "foo"])).toEqual(["foo", "vvfoo"]);
	expect(rowsOf("tool", ["vvx", "vx", "x"])).toEqual(["vvx", "x"]);
	expect(rowsOf("cargo", ["vv1", "v1", "1"])).toEqual(["1", "vv1"]);
});
test("rows with odd versions come out the same in any vote order", () => {
	const versions = ["v", "vv1.2.3", "v1.2.3", "1.2.3", "vvfoo", "1.2.3+b"];
	const votes = versions.map((v, i) => (i % 2 === 0 ? c(v, i) : d(v, i)));
	for (const eco of ["npm", "pypi", "tool", "cargo", "go"] as const) {
		const a = deriveStatus(eco, votes);
		expect(deriveStatus(eco, [...votes].reverse())).toEqual(a);
		expect(
			deriveStatus(eco, [
				votes[3],
				votes[0],
				...votes.slice(4),
				votes[1],
				votes[2],
			] as Vote[]),
		).toEqual(a);
	}
});
