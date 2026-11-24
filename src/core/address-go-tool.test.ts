import { expect, test } from "bun:test";
import { canonicalise, isCanonical } from "./address.ts";

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
