import { expect, test } from "bun:test";
import {
	detectInstalled,
	recordedVersions,
	type WorkspaceFile,
} from "./detect.ts";
import { LIMITS } from "./limits.ts";
import { utf8Length } from "./text.ts";

function npmLock(
	packages: Record<string, unknown>,
	lockfileVersion: unknown = 3,
): WorkspaceFile {
	return {
		name: "package-lock.json",
		text: JSON.stringify({ lockfileVersion, packages }),
	};
}
function entry(version: string, extra: Record<string, unknown> = {}) {
	return { version, ...extra };
}
function cargoBlock(lines: string[]): string {
	return ["[[package]]", ...lines].join("\n");
}
function cargoLock(...blocks: string[][]): WorkspaceFile {
	return {
		name: "Cargo.lock",
		text: `version = 3\n\n${blocks.map(cargoBlock).join("\n\n")}\n`,
	};
}
function goMod(...lines: string[]): WorkspaceFile {
	return { name: "go.mod", text: `${lines.join("\n")}\n` };
}

// ---- npm ----

test("npm: a lockfile v3 entry gives its version", () => {
	const files = [npmLock({ "node_modules/left-pad": entry("1.3.0") })];
	expect(recordedVersions("npm/left-pad", files)).toEqual(["1.3.0"]);
});
test("npm: a scoped name is found under node_modules/@scope/pkg", () => {
	const files = [npmLock({ "node_modules/@scope/pkg": entry("2.0.1") })];
	expect(recordedVersions("npm/@scope/pkg", files)).toEqual(["2.0.1"]);
});
test("npm: a lockfile v2 is understood", () => {
	const files = [npmLock({ "node_modules/left-pad": entry("1.3.0") }, 2)];
	expect(recordedVersions("npm/left-pad", files)).toEqual(["1.3.0"]);
});
test("npm: a nested entry is found too and two different versions are unknown", () => {
	const files = [
		npmLock({
			"node_modules/left-pad": entry("1.3.0"),
			"node_modules/a/node_modules/left-pad": entry("1.1.0"),
		}),
	];
	expect(recordedVersions("npm/left-pad", files)).toEqual(["1.3.0", "1.1.0"]);
	expect<unknown>(detectInstalled("npm/left-pad", undefined, files)).toEqual({
		ok: true,
		value: undefined,
	});
});
test("npm: a nested scoped entry takes everything after the last node_modules/", () => {
	const files = [
		npmLock({
			"node_modules/a/node_modules/@scope/pkg": entry("3.0.0"),
		}),
	];
	expect(recordedVersions("npm/@scope/pkg", files)).toEqual(["3.0.0"]);
});
test("npm: two equal versions at different depths give one answer", () => {
	const files = [
		npmLock({
			"node_modules/left-pad": entry("1.3.0"),
			"node_modules/a/node_modules/left-pad": entry("1.3.0"),
		}),
	];
	expect<unknown>(detectInstalled("npm/left-pad", undefined, files)).toEqual({
		ok: true,
		value: "1.3.0",
	});
});
test("npm: an entry with link true contributes nothing", () => {
	const files = [
		npmLock({
			"node_modules/left-pad": { resolved: "../left-pad", link: true },
			"node_modules/a/node_modules/left-pad": entry("1.3.0", { link: true }),
		}),
	];
	expect(recordedVersions("npm/left-pad", files)).toEqual([]);
});
test("npm: a lookalike name is not matched", () => {
	const files = [
		npmLock({
			"node_modules/left-pad-x": entry("1.0.0"),
			"node_modules/xleft-pad": entry("2.0.0"),
			"node_modules/a/xleft-pad": entry("3.0.0"),
			"node_modules/left-pad/extra": entry("4.0.0"),
			"foo/xnode_modules/left-pad": entry("5.0.0"),
		}),
	];
	expect(recordedVersions("npm/left-pad", files)).toEqual([]);
});
test("npm: a key without a node_modules element is not a package path", () => {
	const files = [
		npmLock({
			"": entry("1.0.0", { name: "left-pad" }),
			"left-pad": entry("1.0.0"),
			"packages/left-pad": entry("1.0.0"),
		}),
	];
	expect(recordedVersions("npm/left-pad", files)).toEqual([]);
});
test("npm: a workspace-prefixed path ending in node_modules/<name> is matched", () => {
	const files = [
		npmLock({ "packages/app/node_modules/left-pad": entry("1.3.0") }),
	];
	expect(recordedVersions("npm/left-pad", files)).toEqual(["1.3.0"]);
});
test("npm: lockfileVersion 1 gives nothing", () => {
	const files = [
		{
			name: "package-lock.json" as const,
			text: JSON.stringify({
				lockfileVersion: 1,
				packages: { "node_modules/left-pad": entry("1.3.0") },
				dependencies: { "left-pad": entry("1.3.0") },
			}),
		},
	];
	expect(recordedVersions("npm/left-pad", files)).toEqual([]);
});
test("npm: other lockfile versions and non-numeric ones give nothing", () => {
	for (const lockfileVersion of [0, 4, "3", null, [3], 2.5]) {
		const files = [
			npmLock({ "node_modules/left-pad": entry("1.3.0") }, lockfileVersion),
		];
		expect(recordedVersions("npm/left-pad", files)).toEqual([]);
	}
	const absent: WorkspaceFile = {
		name: "package-lock.json",
		text: JSON.stringify({
			packages: { "node_modules/left-pad": entry("1.3.0") },
		}),
	};
	expect(recordedVersions("npm/left-pad", [absent])).toEqual([]);
});
test("npm: a missing packages object, invalid JSON and a non-object root give nothing", () => {
	const texts = [
		JSON.stringify({ lockfileVersion: 3 }),
		JSON.stringify({ lockfileVersion: 3, packages: [] }),
		JSON.stringify({ lockfileVersion: 3, packages: null }),
		JSON.stringify({ lockfileVersion: 3, packages: "node_modules/left-pad" }),
		'{"lockfileVersion":3,"packages":{',
		"",
		"not json",
		JSON.stringify([{ lockfileVersion: 3 }]),
		JSON.stringify("text"),
		JSON.stringify(3),
		"null",
	];
	for (const text of texts) {
		const files: WorkspaceFile[] = [{ name: "package-lock.json", text }];
		expect(recordedVersions("npm/left-pad", files)).toEqual([]);
	}
});
test("npm: a case-different name is not matched", () => {
	const files = [npmLock({ "node_modules/Left-Pad": entry("1.3.0") })];
	expect(recordedVersions("npm/left-pad", files)).toEqual([]);
	expect(recordedVersions("npm/Left-Pad", files)).toEqual(["1.3.0"]);
});
test("npm: a __proto__ or constructor key neither crashes nor pollutes", () => {
	const text =
		'{"lockfileVersion":3,"__proto__":{"polluted":"root"},"packages":{' +
		'"__proto__":{"version":"9.9.9","polluted":"entry"},' +
		'"node_modules/constructor":{"version":"1.0.0","__proto__":{"version":"7.7.7","polluted":"nested"}},' +
		'"constructor":{"version":"8.8.8"},' +
		'"node_modules/left-pad":{"version":"1.3.0"}}}';
	const files: WorkspaceFile[] = [{ name: "package-lock.json", text }];
	expect(recordedVersions("npm/left-pad", files)).toEqual(["1.3.0"]);
	expect(recordedVersions("npm/constructor", files)).toEqual(["1.0.0"]);
	expect(recordedVersions("npm/toString", files)).toEqual([]);
	expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	expect(({} as Record<string, unknown>).version).toBeUndefined();
});
test("npm: a __proto__ entry under node_modules and an inherited version give no versions", () => {
	const text =
		'{"lockfileVersion":3,"packages":{"node_modules/__proto__":{"version":"1.0.0"},"node_modules/hasOwnProperty":{"x":1},"node_modules/valueOf":null}}';
	const files: WorkspaceFile[] = [{ name: "package-lock.json", text }];
	expect(recordedVersions("npm/hasOwnProperty", files)).toEqual([]);
	expect(recordedVersions("npm/valueOf", files)).toEqual([]);
	expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});
test("npm: a version that is not a string contributes nothing", () => {
	const files = [
		npmLock({
			"node_modules/a": { version: 1 },
			"node_modules/b": { version: { major: 1 } },
			"node_modules/c": { version: null },
			"node_modules/d": { version: ["1.0.0"] },
			"node_modules/e": { version: true },
			"node_modules/f": {},
			"node_modules/g": null,
			"node_modules/h": 5,
			"node_modules/i": "1.0.0",
			"node_modules/j": ["1.0.0"],
		}),
	];
	for (const name of "abcdefghij") {
		expect(recordedVersions(`npm/${name}`, files)).toEqual([]);
	}
});
test("npm: a non-string-path key such as an array index is ignored", () => {
	const text =
		'{"lockfileVersion":3,"packages":{"0":{"version":"1.0.0"},"1":{"version":"2.0.0"}}}';
	expect(
		recordedVersions("npm/left-pad", [{ name: "package-lock.json", text }]),
	).toEqual([]);
});

// ---- cargo ----

test("cargo: two blocks of one crate at two versions give both, in file order", () => {
	const files = [
		cargoLock(
			['name = "serde"', 'version = "1.0.100"'],
			['name = "other"', 'version = "0.1.0"'],
			['name = "serde"', 'version = "1.0.200"'],
		),
	];
	expect(recordedVersions("cargo/serde", files)).toEqual([
		"1.0.100",
		"1.0.200",
	]);
	expect<unknown>(detectInstalled("cargo/serde", undefined, files)).toEqual({
		ok: true,
		value: undefined,
	});
});
test("cargo: a crate written my_crate in the lock matches the box cargo/my-crate", () => {
	const files = [cargoLock(['name = "my_crate"', 'version = "0.4.2"'])];
	expect(recordedVersions("cargo/my-crate", files)).toEqual(["0.4.2"]);
});
test("cargo: a mixed-case crate name matches its lower-case box", () => {
	const files = [cargoLock(['name = "My_Crate"', 'version = "0.4.2"'])];
	expect(recordedVersions("cargo/my-crate", files)).toEqual(["0.4.2"]);
});
test("cargo: a block without a version line contributes nothing", () => {
	const files = [
		cargoLock(['name = "serde"'], ['name = "serde-x"', 'version = "1.0.0"']),
	];
	expect(recordedVersions("cargo/serde", files)).toEqual([]);
});
test("cargo: a block without a name line contributes nothing", () => {
	const files = [cargoLock(['version = "1.0.0"'])];
	expect(recordedVersions("cargo/serde", files)).toEqual([]);
});
test("cargo: a source line, checksum and dependencies are ignored", () => {
	const files = [
		cargoLock([
			'name = "serde"',
			'version = "1.0.200"',
			'source = "registry+https://github.com/rust-lang/crates.io-index"',
			'checksum = "abc"',
			"dependencies = [",
			' "serde_derive",',
			"]",
		]),
	];
	expect(recordedVersions("cargo/serde", files)).toEqual(["1.0.200"]);
});
test("cargo: name and version in either order are found", () => {
	const files = [cargoLock(['version = "1.0.0"', 'name = "serde"'])];
	expect(recordedVersions("cargo/serde", files)).toEqual(["1.0.0"]);
});
test("cargo: only the first name and the first version of a block count", () => {
	const files = [
		cargoLock(['name = "serde"', 'version = "1.0.0"', 'version = "2.0.0"']),
	];
	expect(recordedVersions("cargo/serde", files)).toEqual(["1.0.0"]);
});
test("cargo: a lookalike crate is not matched and a name that does not canonicalise is ignored", () => {
	const files = [
		cargoLock(
			['name = "serde-x"', 'version = "1.0.0"'],
			['name = "xserde"', 'version = "2.0.0"'],
			['name = "1bad"', 'version = "3.0.0"'],
			['name = ""', 'version = "4.0.0"'],
		),
	];
	expect(recordedVersions("cargo/serde", files)).toEqual([]);
});
test("cargo: only exact key = double-quoted-value lines are read", () => {
	const files = [
		cargoLock(
			["name = 'serde'", 'version = "1.0.0"'],
			['name = "serde" # comment', 'version = "2.0.0"'],
			['name  = "serde"', 'version = "3.0.0"'],
			['name = "serde"', "version = '4.0.0'"],
			['name = "serde"', 'version = "5.0.0" # comment'],
		),
	];
	expect(recordedVersions("cargo/serde", files)).toEqual([]);
});
test("cargo: lines of the [metadata] table are not attributed to a block", () => {
	const text =
		'[[package]]\nname = "other"\n\n[metadata]\nname = "serde"\nversion = "9.9.9"\n';
	expect(
		recordedVersions("cargo/serde", [{ name: "Cargo.lock", text }]),
	).toEqual([]);
});
test("cargo: CRLF line ends parse like LF", () => {
	const text = [
		"version = 3",
		"",
		"[[package]]",
		'name = "my_crate"',
		'version = "0.4.2"',
		"",
		"[[package]]",
		'name = "my_crate"',
		'version = "0.5.0"',
		"",
	].join("\r\n");
	expect(
		recordedVersions("cargo/my-crate", [{ name: "Cargo.lock", text }]),
	).toEqual(["0.4.2", "0.5.0"]);
});
test("cargo: a name line inside a multi-line string is not a name line", () => {
	const text = [
		"[[package]]",
		'description = """',
		'name = "serde"',
		'version = "9.9.9"',
		"[[package]]",
		'"""',
		'name = "serde"',
		'version = "1.0.0"',
		"",
		"[[package]]",
		"description = '''",
		'name = "serde"',
		'version = "8.8.8"',
		"'''",
		'name = "other"',
		'version = "2.0.0"',
		"",
		"[[package]]",
		'description = """one line"""',
		'name = "serde"',
		'version = "3.0.0"',
	].join("\n");
	expect(
		recordedVersions("cargo/serde", [{ name: "Cargo.lock", text }]),
	).toEqual(["1.0.0", "3.0.0"]);
});
test("cargo: the plain cases still parse next to a never-closed multi-line string", () => {
	const text = [
		"[[package]]",
		'name = "serde"',
		'version = "1.0.0"',
		'description = """',
		"[[package]]",
		'name = "serde"',
		'version = "2.0.0"',
	].join("\n");
	expect(
		recordedVersions("cargo/serde", [{ name: "Cargo.lock", text }]),
	).toEqual(["1.0.0"]);
});

// ---- go ----

test("go: a single-line require", () => {
	const files = [
		goMod("module example.com/m", "", "require rsc.io/quote v1.5.2"),
	];
	expect(recordedVersions("go/rsc.io/quote", files)).toEqual(["v1.5.2"]);
});
test("go: a require block", () => {
	const files = [
		goMod(
			"module example.com/m",
			"go 1.21",
			"require (",
			"\trsc.io/quote v1.5.2",
			"\tgolang.org/x/text v0.3.0",
			")",
		),
	];
	expect(recordedVersions("go/rsc.io/quote", files)).toEqual(["v1.5.2"]);
	expect(recordedVersions("go/golang.org/x/text", files)).toEqual(["v0.3.0"]);
});
test("go: a trailing // indirect comment is removed", () => {
	const files = [
		goMod(
			"require (",
			"\trsc.io/quote v1.5.2 // indirect",
			")",
			"require golang.org/x/text v0.3.0 // indirect",
		),
	];
	expect(recordedVersions("go/rsc.io/quote", files)).toEqual(["v1.5.2"]);
	expect(recordedVersions("go/golang.org/x/text", files)).toEqual(["v0.3.0"]);
});
test("go: a /v2 module path matches the unversioned box", () => {
	const files = [goMod("require github.com/a/b/v2 v2.3.0")];
	expect(recordedVersions("go/github.com/a/b", files)).toEqual(["v2.3.0"]);
});
test("go: two majors of one module give both", () => {
	const files = [
		goMod(
			"require (",
			"\tgithub.com/a/b v1.0.0",
			"\tgithub.com/a/b/v2 v2.3.0",
			")",
		),
	];
	expect(recordedVersions("go/github.com/a/b", files)).toEqual([
		"v1.0.0",
		"v2.3.0",
	]);
});
test("go: replace, exclude, retract and toolchain directives are ignored", () => {
	const files = [
		goMod(
			"module example.com/m",
			"go 1.21",
			"toolchain go1.22.1",
			"replace rsc.io/quote v1.5.2 => rsc.io/quote v1.9.9",
			"replace rsc.io/quote => ../quote",
			"exclude rsc.io/quote v1.5.1",
			"retract v1.0.0",
			"replace (",
			"\trsc.io/quote v1.5.0 => rsc.io/quote v1.5.3",
			")",
			"exclude (",
			"\trsc.io/quote v1.5.4",
			")",
			"retract (",
			"\tv1.0.1",
			"\t[v1.0.2, v1.0.4]",
			")",
		),
	];
	expect(recordedVersions("go/rsc.io/quote", files)).toEqual([]);
});
test("go: a pseudo-version is accepted as recorded", () => {
	const files = [
		goMod("require example.com/x v0.0.0-20200101000000-abcdefabcdef"),
	];
	expect(recordedVersions("go/example.com/x", files)).toEqual([
		"v0.0.0-20200101000000-abcdefabcdef",
	]);
	expect<unknown>(
		detectInstalled("go/example.com/x", undefined, files),
	).toEqual({ ok: true, value: "v0.0.0-20200101000000-abcdefabcdef" });
});
test("go: a path of another module is not matched", () => {
	const files = [
		goMod(
			"require (",
			"\texample.com/xy v1.0.0",
			"\tother.example.com/x v2.0.0",
			"\texample.com/x/sub v3.0.0",
			")",
		),
	];
	expect(recordedVersions("go/example.com/x", files)).toEqual([]);
});
test("go: CRLF line ends parse like LF", () => {
	const text = [
		"module example.com/m",
		"",
		"require (",
		"\trsc.io/quote v1.5.2 // indirect",
		"\tgithub.com/a/b/v2 v2.3.0",
		")",
		"require golang.org/x/text v0.3.0",
		"",
	].join("\r\n");
	const files: WorkspaceFile[] = [{ name: "go.mod", text }];
	expect(recordedVersions("go/rsc.io/quote", files)).toEqual(["v1.5.2"]);
	expect(recordedVersions("go/github.com/a/b", files)).toEqual(["v2.3.0"]);
	expect(recordedVersions("go/golang.org/x/text", files)).toEqual(["v0.3.0"]);
});
test("go: a require block that is never closed does not crash and is not understood", () => {
	const text = "module example.com/m\r\nrequire (\r\n\trsc.io/quote v1.5.2\r\n";
	const files: WorkspaceFile[] = [{ name: "go.mod", text }];
	expect(recordedVersions("go/rsc.io/quote", files)).toEqual([]);
	const otherBlock =
		"replace (\n\ta.b/c v1.0.0 => ../c\nrequire a.b/d v1.0.0\n";
	expect(
		recordedVersions("go/a.b/d", [{ name: "go.mod", text: otherBlock }]),
	).toEqual([]);
});
test("go: lines that are not a require directive are not read as one", () => {
	const files = [
		goMod(
			"requirement rsc.io/quote v1.5.2",
			"require rsc.io/quote",
			"require rsc.io/quote v1.5.2 extra",
			"require",
			"// require rsc.io/quote v1.5.2",
			"module rsc.io/quote",
		),
	];
	expect(recordedVersions("go/rsc.io/quote", files)).toEqual([]);
});

// ---- ignored ----

const ALL_FILES: WorkspaceFile[] = [
	npmLock({
		"node_modules/left-pad": entry("1.3.0"),
		"node_modules/pkg": entry("1.0.0"),
	}),
	cargoLock(['name = "pkg"', 'version = "1.0.0"']),
	goMod("require example.com/pkg v1.0.0"),
];

test("a file with another name is ignored", () => {
	const text = JSON.stringify({
		lockfileVersion: 3,
		packages: { "node_modules/left-pad": entry("1.3.0") },
	});
	const files = [{ name: "yarn.lock", text }] as unknown as WorkspaceFile[];
	expect(recordedVersions("npm/left-pad", files)).toEqual([]);
	const nested = [
		{ name: "sub/package-lock.json", text },
	] as unknown as WorkspaceFile[];
	expect(recordedVersions("npm/left-pad", nested)).toEqual([]);
});
test("a file over lockFileBytes is not understood, one at the limit is", () => {
	const base = "require example.com/x v1.0.0 // ";
	const fill = LIMITS.lockFileBytes - utf8Length(base);
	const twoByte = "\u00e9".repeat(Math.floor(fill / 2));
	const exact = `${base}${twoByte}${"x".repeat(fill - 2 * twoByte.length)}`;
	expect(utf8Length(exact)).toBe(LIMITS.lockFileBytes);
	// Fewer characters than bytes: only a byte count passes this.
	expect(exact.length).toBeLessThan(LIMITS.lockFileBytes);
	expect(
		recordedVersions("go/example.com/x", [{ name: "go.mod", text: exact }]),
	).toEqual(["v1.0.0"]);
	const over = `${exact}x`;
	expect(utf8Length(over)).toBe(LIMITS.lockFileBytes + 1);
	expect(
		recordedVersions("go/example.com/x", [{ name: "go.mod", text: over }]),
	).toEqual([]);
});
test("a package-lock.json at the limit is understood and one byte more is not", () => {
	const base = JSON.stringify({
		lockfileVersion: 3,
		packages: { "node_modules/left-pad": entry("1.3.0") },
	});
	const exact = base + " ".repeat(LIMITS.lockFileBytes - utf8Length(base));
	expect(utf8Length(exact)).toBe(LIMITS.lockFileBytes);
	expect(
		recordedVersions("npm/left-pad", [
			{ name: "package-lock.json", text: exact },
		]),
	).toEqual(["1.3.0"]);
	expect(
		recordedVersions("npm/left-pad", [
			{ name: "package-lock.json", text: `${exact} ` },
		]),
	).toEqual([]);
});
test("a pypi and a tool box give nothing from any file", () => {
	expect(recordedVersions("pypi/pkg", ALL_FILES)).toEqual([]);
	expect(recordedVersions("tool/example.com/pkg", ALL_FILES)).toEqual([]);
});
test("a file of another ecosystem is not read for the box", () => {
	expect(recordedVersions("npm/pkg", [ALL_FILES[1] as WorkspaceFile])).toEqual(
		[],
	);
	expect(recordedVersions("npm/pkg", [ALL_FILES[2] as WorkspaceFile])).toEqual(
		[],
	);
	expect(
		recordedVersions("cargo/pkg", [ALL_FILES[0] as WorkspaceFile]),
	).toEqual([]);
	expect(
		recordedVersions("go/example.com/pkg", [ALL_FILES[1] as WorkspaceFile]),
	).toEqual([]);
	expect(recordedVersions("npm/pkg", ALL_FILES)).toEqual(["1.0.0"]);
	expect(recordedVersions("cargo/pkg", ALL_FILES)).toEqual(["1.0.0"]);
	expect(recordedVersions("go/example.com/pkg", ALL_FILES)).toEqual(["v1.0.0"]);
});
test("versions of several files are returned in file order", () => {
	const files = [
		npmLock({ "node_modules/pkg": entry("2.0.0") }),
		npmLock({ "node_modules/pkg": entry("1.0.0") }),
	];
	expect(recordedVersions("npm/pkg", files)).toEqual(["2.0.0", "1.0.0"]);
});
test("no files give no versions", () => {
	expect(recordedVersions("npm/pkg", [])).toEqual([]);
});

// ---- canonical addresses ----

test("recordedVersions refuses an address that is not canonical", () => {
	expect(() => recordedVersions("npm/", ALL_FILES)).toThrow(
		"not a canonical address",
	);
	expect(() => recordedVersions("cargo/My_Crate", ALL_FILES)).toThrow(
		"not a canonical address",
	);
	expect(() => recordedVersions("", ALL_FILES)).toThrow(
		"not a canonical address",
	);
});
test("detectInstalled refuses an address that is not canonical", () => {
	expect(() => detectInstalled("cargo/My_Crate", undefined, ALL_FILES)).toThrow(
		"not a canonical address",
	);
	expect(() => detectInstalled("nope/x", "1.0.0", ALL_FILES)).toThrow(
		"not a canonical address",
	);
});

// ---- detectInstalled ----

const LEFT_PAD = [npmLock({ "node_modules/left-pad": entry("1.3.0") })];

test("detectInstalled: an explicit valid version wins over the files", () => {
	expect<unknown>(detectInstalled("npm/left-pad", "9.9.9", LEFT_PAD)).toEqual({
		ok: true,
		value: "9.9.9",
	});
});
test("detectInstalled: an explicit invalid version is refused", () => {
	expect<unknown>(detectInstalled("npm/left-pad", "1 2", LEFT_PAD)).toEqual({
		ok: false,
		error: "invalid-version",
	});
	expect<unknown>(detectInstalled("npm/left-pad", "", LEFT_PAD)).toEqual({
		ok: false,
		error: "invalid-version",
	});
});
test("detectInstalled: one recorded version is returned", () => {
	expect<unknown>(detectInstalled("npm/left-pad", undefined, LEFT_PAD)).toEqual(
		{ ok: true, value: "1.3.0" },
	);
});
test("detectInstalled: several distinct versions are unknown", () => {
	const files = [
		npmLock({
			"node_modules/left-pad": entry("1.3.0"),
			"node_modules/a/node_modules/left-pad": entry("1.2.0"),
		}),
	];
	expect<unknown>(detectInstalled("npm/left-pad", undefined, files)).toEqual({
		ok: true,
		value: undefined,
	});
});
test("detectInstalled: none recorded is unknown", () => {
	expect<unknown>(detectInstalled("npm/other", undefined, LEFT_PAD)).toEqual({
		ok: true,
		value: undefined,
	});
	expect<unknown>(detectInstalled("npm/left-pad", undefined, [])).toEqual({
		ok: true,
		value: undefined,
	});
});
test("detectInstalled: a recorded version that is not valid is unknown", () => {
	const files = [npmLock({ "node_modules/left-pad": entry("1.3.0 beta") })];
	expect(recordedVersions("npm/left-pad", files)).toEqual(["1.3.0 beta"]);
	expect<unknown>(detectInstalled("npm/left-pad", undefined, files)).toEqual({
		ok: true,
		value: undefined,
	});
});
test("detectInstalled: for a tool box the files are not consulted", () => {
	expect<unknown>(
		detectInstalled("tool/example.com/pkg", undefined, ALL_FILES),
	).toEqual({ ok: true, value: undefined });
	expect<unknown>(
		detectInstalled("tool/example.com/pkg", "1.2.3", ALL_FILES),
	).toEqual({ ok: true, value: "1.2.3" });
});
test("detectInstalled: go and cargo boxes are detected", () => {
	expect<unknown>(detectInstalled("cargo/pkg", undefined, ALL_FILES)).toEqual({
		ok: true,
		value: "1.0.0",
	});
	expect<unknown>(
		detectInstalled("go/example.com/pkg", undefined, ALL_FILES),
	).toEqual({ ok: true, value: "v1.0.0" });
});
test("a range among recorded versions makes the answer unknown, but an explicit version still wins", () => {
	const files = [
		npmLock({
			"node_modules/left-pad": entry("1.3.0"),
			"node_modules/a/node_modules/left-pad": entry("^1.2.0"),
		}),
	];
	expect<unknown>(detectInstalled("npm/left-pad", undefined, files)).toEqual({
		ok: true,
		value: undefined,
	});
	expect<unknown>(detectInstalled("npm/left-pad", "1.3.0", files)).toEqual({
		ok: true,
		value: "1.3.0",
	});
});
test("detection never returns a range", () => {
	for (const range of ["^1.2.0", "~1.2"]) {
		const files = [npmLock({ "node_modules/left-pad": entry(range) })];
		expect<unknown>(detectInstalled("npm/left-pad", undefined, files)).toEqual({
			ok: true,
			value: undefined,
		});
		const cargo = [cargoLock(['name = "serde"', `version = "${range}"`])];
		expect<unknown>(detectInstalled("cargo/serde", undefined, cargo)).toEqual({
			ok: true,
			value: undefined,
		});
		const go = [goMod(`require example.com/x ${range}`)];
		expect<unknown>(detectInstalled("go/example.com/x", undefined, go)).toEqual(
			{ ok: true, value: undefined },
		);
	}
});
