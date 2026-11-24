import { expect, test } from "bun:test";
import { canonicalise, ecosystemOf, isCanonical } from "./address.ts";

const ok = (input: string, out: string) => {
	expect<unknown>(canonicalise(input)).toEqual({ ok: true, value: out });
	expect<unknown>(canonicalise(out)).toEqual({ ok: true, value: out }); // idempotent
	expect(isCanonical(out)).toBe(true);
};
const bad = (input: string) =>
	expect<unknown>(canonicalise(input)).toEqual({
		ok: false,
		error: "bad-name",
	});

test("go lowercases the host only and keeps the path's case", () => {
	ok(
		"go/GitHub.com/Azure/azure-sdk-for-go",
		"go/github.com/Azure/azure-sdk-for-go",
	);
	ok("go/example.com/M", "go/example.com/M");
	ok("go/example.com/m", "go/example.com/m");
	ok("go/golang.org/x/mod", "go/golang.org/x/mod");
	ok("go/example.com", "go/example.com");
});
test("go major versions share one box", () => {
	ok("go/github.com/a/b/v2", "go/github.com/a/b");
	ok("go/github.com/a/b/v15", "go/github.com/a/b");
	ok("go/example.com/v2", "go/example.com");
	for (const p of [
		"github.com/a/b/v0",
		"github.com/a/b/v1",
		"github.com/a/b/v02",
		"github.com/a/b/v2.1",
		"github.com/a/b/v2/v3",
		"github.com/a/b/v1/v2",
	])
		bad(`go/${p}`);
	ok("go/github.com/a/v2x", "go/github.com/a/v2x"); // not a version element
});
test("a host that looks like a version is still a host", () => {
	ok("go/v8.dev", "go/v8.dev");
	ok("go/v0.dev", "go/v0.dev");
	ok("go/v0.dev/pkg", "go/v0.dev/pkg");
	ok("go/v2.example.com/v2", "go/v2.example.com");
});
test("gopkg.in paths lose .vN and stay canonical without it", () => {
	ok("go/gopkg.in/yaml.v2", "go/gopkg.in/yaml");
	ok("go/gopkg.in/yaml.v0", "go/gopkg.in/yaml");
	ok("go/gopkg.in/user/pkg.v3", "go/gopkg.in/user/pkg");
	ok("go/gopkg.in/yaml", "go/gopkg.in/yaml");
	for (const p of [
		"gopkg.in",
		"gopkg.in/a/b/c.v1",
		"gopkg.in/yaml.v02",
		"gopkg.in/yaml.v2.1",
		"gopkg.in/pkg..v2",
		"gopkg.in/pkg.v2.v3",
	])
		bad(`go/${p}`);
});
test("go refuses what CheckPath refuses", () => {
	for (const p of [
		"",
		"example",
		"-a.com/x",
		"example.com/",
		"/example.com",
		"example.com//x",
		"example.com/.x",
		"example.com/x.",
		"example.com/..",
		"example.com/a b",
		"example.com/café",
		"example.com/CON",
		"example.com/con.txt",
		"example.com/Lpt1",
		"example.com/exampl~1.go",
		"exa_mple.com/x",
		"example.com/x?y",
	])
		bad(`go/${p}`);
	ok("go/example.com/a~b", "go/example.com/a~b");
	ok("go/example.com/con1", "go/example.com/con1");
});
test("every form of one upstream gives one tool address", () => {
	const want = "tool/github.com/org/repo";
	for (const input of [
		"github.com/org/repo",
		"GitHub.com/Org/Repo",
		"https://github.com/org/repo",
		"HTTPS://github.com/org/repo.git",
		"https://user:pw@github.com:443/org/repo.git/?a=b#frag",
		"ssh://git@github.com/org/repo.git",
		"git://github.com/org/repo",
		"git@github.com:org/repo.git",
		"http://github.com/org/repo///",
	])
		ok(`tool/${input}`, want);
	ok(
		"tool/gitlab.com/group/sub/proj_1.x~y",
		"tool/gitlab.com/group/sub/proj_1.x~y",
	);
});
test("tool reads user and port from the authority only", () => {
	for (const input of [
		"https://github.com/org/repo:443",
		"https://github.com/org/a@evil.com/x",
		"https://@github.com/org/repo",
		"https://a@b@github.com/org/repo",
		"https://github.com:/org/repo",
		"https://github.com",
		"a@b@github.com:org/repo",
		"git@github.com/org/repo",
		"github.com/org/a@b",
	])
		bad(`tool/${input}`);
});
test("the remote form has no port: digits after the colon are a path element", () => {
	ok("tool/git@github.com:443/org/repo.git", "tool/github.com/443/org/repo");
});
test("tool refuses, never repairs", () => {
	for (const input of [
		"",
		"github.com",
		"github.com/",
		"localhost/x",
		"https://github.com/org/../repo",
		"github.com/org/./repo",
		"github.com//repo",
		"github.com/org/repo.git.git",
		"github.com/org/.git",
		"ftp://github.com/org/repo",
		"https://github.com:port/org/repo",
		".github.com/x",
		"github.com./x",
		"git..hub.com/x",
		"-a.com/x",
		"a-.com/x",
		"github.com/org/re po",
		"github.com/org/café",
		"github.com/org/repo!",
		"@github.com:org/repo",
		"a b@github.com:org/repo",
		"git@github.com:org/repo?x",
	])
		bad(`tool/${input}`);
});

const NUL = String.fromCharCode(0);
const BIDI = String.fromCharCode(0x202e);
test("a tool name with a character outside printable ASCII is refused, even in a discarded part", () => {
	bad(`tool/https://a b${NUL}@github.com/org/repo`); // credentials
	bad("tool/https://github.com/org/repo# bad\ntext"); // fragment
	bad(`tool/https://github.com/org/repo?x=1${BIDI}`); // query
	bad(`tool/${NUL}@github.com:org/repo`); // remote user
	bad("tool/café@github.com:org/repo"); // remote user, non-ASCII
	bad("tool/https://github.com/org/repo?x=a b"); // a space alone
	bad("tool/github.com/org/repo\n"); // a trailing line feed
	bad("tool/github.com/org/repo\t");
	bad("tool/https://github.com/org/repo#é");
});
test("a tool name with a query, fragment, user or port is still accepted when printable", () => {
	ok("tool/https://github.com/org/repo?x=1", "tool/github.com/org/repo");
	ok("tool/https://user@github.com/org/repo#frag", "tool/github.com/org/repo");
	ok("tool/git@github.com:org/repo", "tool/github.com/org/repo");
	ok("tool/https://github.com:8443/org/repo", "tool/github.com/org/repo");
});
test("the stray-character rule applies to the tool prefix only", () => {
	expect<unknown>(canonicalise(`npm/left${NUL}pad`)).toEqual({
		ok: false,
		error: "bad-name",
	});
	expect<unknown>(canonicalise("tool/github.com/org/repo")).toEqual({
		ok: true,
		value: "tool/github.com/org/repo",
	});
});

const DEL = String.fromCharCode(127);
test("the stray-character rule keeps the order of the other checks", () => {
	const err = (input: string, error: string) =>
		expect<unknown>(canonicalise(input)).toEqual({ ok: false, error });
	err("gem/a b", "unknown-prefix"); // the prefix is judged first
	err(`gem/a${NUL}b`, "unknown-prefix");
	err(`npm/${"a".repeat(1100)}é`, "too-long"); // the raw length is judged first
	err(`tool/github.com/${"a".repeat(1100)}é`, "too-long");
	err(`npm/left${NUL}pad`, "bad-name");
	err(`pypi/left${NUL}pad`, "bad-name");
	err("npm/café", "bad-name");
});
test("DEL is outside printable ASCII in every part of a tool name", () => {
	bad(`tool/github.com/org/re${DEL}po`);
	bad(`tool/https://github.com/org/repo?x=${DEL}`); // query
	bad(`tool/https://github.com/org/repo#${DEL}`); // fragment
	bad(`tool/https://a${DEL}@github.com/org/repo`); // credentials
	bad(`tool/a${DEL}@github.com:org/repo`); // remote user
	bad(`tool/github.com/org/repo${DEL}`);
});
test("the first and last printable ASCII characters are judged by the element rules, not the charset rule", () => {
	ok("tool/github.com/org/a~b", "tool/github.com/org/a~b"); // U+007E is an element character
	bad("tool/github.com/org/a!b"); // U+0021 is not
	bad("tool/github.com/org/!");
	ok("tool/https://github.com/org/repo?x=!", "tool/github.com/org/repo"); // allowed in a discarded query
	ok("tool/https://github.com/org/repo?x=~", "tool/github.com/org/repo");
	ok("tool/https://github.com/org/repo#!~", "tool/github.com/org/repo");
	ok("tool/https://!~@github.com/org/repo", "tool/github.com/org/repo"); // credentials
	ok("tool/!~@github.com:org/repo", "tool/github.com/org/repo"); // remote user
});

test("a final element is a version only when it is v plus digits and dots", () => {
	for (const e of ["v1.x", "v8.dev", "v2.dev", "v", "vx", "v1x", "av1.2"])
		ok(`go/example.com/x/${e}`, `go/example.com/x/${e}`);
	ok("go/example.com/v8.dev", "go/example.com/v8.dev");
	for (const e of ["v.2", "v2.", "v.", "v1.2", "v..", "v.2.3", "v0.1"])
		bad(`go/example.com/x/${e}`);
	ok("go/example.com/x/v8.dev/v3", "go/example.com/x/v8.dev"); // v8.dev is not a version element
	bad("go/example.com/x/v.2/v3");
});
test("gopkg.in drops -unstable with the version and refuses a bare .v", () => {
	ok("go/gopkg.in/yaml.v2-unstable", "go/gopkg.in/yaml");
	ok("go/gopkg.in/user/pkg.v3-unstable", "go/gopkg.in/user/pkg");
	bad("go/gopkg.in/yaml.v-unstable"); // round 3: no real package has this name
	bad("go/gopkg.in/yaml.v");
	bad("go/gopkg.in/yaml.v0-unstable");
	bad("go/gopkg.in/yaml.v02-unstable");
	bad("go/gopkg.in/yaml.v2.1-unstable");
	bad("go/gopkg.in/yaml.v2.v3-unstable");
});

test("a gopkg.in name is refused or canonicalises to a fixed point", () => {
	for (const p of [
		"yaml.v2-unstable.v3",
		"yaml.v.v2",
		"yaml.v.v-unstable",
		"yaml.v-unstable.v2",
		"yaml.v0-unstable.v2",
		"yaml.v2-unstable.v-unstable",
		"yaml.v-unstable",
		"yaml.v",
		"yaml.v0-unstable",
	])
		bad(`go/gopkg.in/${p}`);
	ok("go/gopkg.in/yaml.v2-unstable", "go/gopkg.in/yaml");
	ok("go/gopkg.in/yaml.v2", "go/gopkg.in/yaml");
	ok("go/gopkg.in/yaml", "go/gopkg.in/yaml");
	ok("go/gopkg.in/yaml.v0", "go/gopkg.in/yaml");
	ok("go/gopkg.in/pkg.v.foo.v2", "go/gopkg.in/pkg.v.foo");
});
test("what is left of a gopkg.in name must itself be a plain element", () => {
	bad("go/gopkg.in/pkg..v2"); // the left part "pkg." is not an element
	// Known over-refusal, parked: Go accepts an internal ".vN.word" segment,
	// but the leftmost version match used here refuses it.
	bad("go/gopkg.in/pkg.v2.foo.v3");
});

test("canonicalising a go name twice changes nothing, over a small grammar", () => {
	const hosts = ["gopkg.in", "github.com", "v8.dev", "GitHub.com"];
	const elements = [
		"yaml",
		"yaml.v2",
		"yaml.v",
		"yaml.v0",
		"yaml.v2-unstable",
		"yaml.v-unstable",
		"yaml.v0-unstable",
		"yaml.v2-unstable.1",
		"yaml.v2.3",
		"yaml.v.v2",
		"yaml.v2.v3",
		"yaml-unstable",
		"v1",
		"v2",
		"v10",
		"v0",
		"v02",
		"v1.x",
		"v8.dev",
		"v.2",
		"v2.",
		"v",
		"a..b",
		"go-yaml",
		"con",
		"a~1",
		"-x",
		"x.v3",
		"x.v3-unstable",
		"V2",
	];
	const paths: string[][] = [[]];
	for (let depth = 0; depth < 3; depth++)
		for (const path of paths.slice(paths.findIndex((p) => p.length === depth)))
			for (const e of elements) paths.push([...path, e]);
	let accepted = 0;
	let calls = 0;
	for (const host of hosts)
		for (const path of paths) {
			if (path.length === 0) continue;
			calls++;
			const first = canonicalise(`go/${[host, ...path].join("/")}`);
			if (!first.ok) continue;
			accepted++;
			const c = first.value;
			expect<unknown>(canonicalise(c)).toEqual({ ok: true, value: c });
			expect(isCanonical(c)).toBe(true);
			expect(ecosystemOf(c)).toBe("go");
		}
	expect(calls).toBe(4 * (30 + 30 ** 2 + 30 ** 3));
	expect(accepted).toBeGreaterThan(1000);
});
