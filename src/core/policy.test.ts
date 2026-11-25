import { describe, expect, test } from "bun:test";
import {
	type Call,
	DEFAULT_POLICY,
	type Permission,
	type Policy,
	type PolicyEntry,
	type PolicyMode,
	policyPermission,
	readPolicy,
	resolvePolicy,
} from "./policy.ts";

const file = (over: Record<string, unknown> = {}) => ({
	formatVersion: 1,
	defaultMode: "deny",
	unattendedPostRead: false,
	rules: [],
	...over,
});
const policy = (
	rules: PolicyEntry[],
	defaultMode: PolicyMode = "deny",
	unattendedPostRead = false,
): Policy => ({ formatVersion: 1, defaultMode, unattendedPostRead, rules });
const call = (over: Partial<Call> = {}): Call => ({
	directory: "/work/app",
	remotes: [],
	vetoed: false,
	...over,
});
const badField = (value: unknown) =>
	expect<unknown>(readPolicy(value)).toEqual({ ok: false, error: "bad-field" });

describe("readPolicy", () => {
	test("the default policy file is read as itself", () => {
		expect<unknown>(readPolicy(file())).toEqual({
			ok: true,
			value: DEFAULT_POLICY,
		});
		expect(DEFAULT_POLICY).toEqual({
			formatVersion: 1,
			defaultMode: "deny",
			unattendedPostRead: false,
			rules: [],
		});
	});

	test("a full policy is read with its rules", () => {
		const input = file({
			defaultMode: "confirm-each",
			unattendedPostRead: true,
			rules: [
				{ directory: "/work/app", mode: "allow", unattendedPostRead: false },
				{ remote: "github.com/me/repo", mode: "deny" },
			],
		});
		expect<unknown>(readPolicy(input)).toEqual({ ok: true, value: input });
	});

	test("an unknown top-level field is refused", () => {
		badField(file({ extra: 1 }));
	});

	test("an unknown field inside a rule is refused", () => {
		badField(
			file({ rules: [{ directory: "/a", mode: "allow", extra: true }] }),
		);
	});

	test("an unknown mode is refused, as is a mode in another case", () => {
		badField(file({ rules: [{ directory: "/a", mode: "Allow" }] }));
		badField(file({ defaultMode: "Allow" }));
		badField(file({ defaultMode: "maybe" }));
		badField(file({ rules: [{ directory: "/a" }] }));
	});

	test("a relative directory is refused", () => {
		badField(file({ rules: [{ directory: "work/app", mode: "allow" }] }));
		badField(file({ rules: [{ directory: "", mode: "allow" }] }));
	});

	test("a directory with a dot segment, an empty segment or a NUL is refused", () => {
		for (const directory of [
			"/a/../b",
			"/a/./b",
			"/..",
			"/.",
			"/a//b",
			"//",
			"/a//",
			"/a\0b",
		]) {
			badField(file({ rules: [{ directory, mode: "allow" }] }));
		}
	});

	test("a remote that does not canonicalise is refused", () => {
		badField(file({ rules: [{ remote: "nonsense", mode: "allow" }] }));
		badField(file({ rules: [{ remote: 7, mode: "allow" }] }));
	});

	test("an entry with both or neither of directory and remote is refused", () => {
		badField(
			file({
				rules: [
					{ directory: "/a", remote: "github.com/me/repo", mode: "allow" },
				],
			}),
		);
		badField(file({ rules: [{ mode: "allow" }] }));
	});

	test("a non-boolean flag is refused", () => {
		badField(file({ unattendedPostRead: "yes" }));
		badField(
			file({
				rules: [{ directory: "/a", mode: "allow", unattendedPostRead: "yes" }],
			}),
		);
	});

	test("a missing or mistyped top-level field is refused", () => {
		badField(file({ rules: undefined }));
		badField(file({ rules: {} }));
		badField(file({ defaultMode: undefined }));
		badField(file({ unattendedPostRead: undefined }));
		badField(file({ rules: ["/a"] }));
		badField(file({ rules: [null] }));
	});

	test("a property whose value is undefined is treated as absent", () => {
		expect<unknown>(readPolicy(file({ extra: undefined }))).toEqual({
			ok: true,
			value: DEFAULT_POLICY,
		});
		expect<unknown>(
			readPolicy(
				file({
					rules: [
						{
							directory: "/a",
							remote: undefined,
							mode: "allow",
							unattendedPostRead: undefined,
						},
					],
				}),
			),
		).toEqual({
			ok: true,
			value: policy([{ directory: "/a", mode: "allow" }]),
		});
	});

	test("a formatVersion other than 1 is unknown-format", () => {
		expect<unknown>(readPolicy(file({ formatVersion: 2 }))).toEqual({
			ok: false,
			error: "unknown-format",
		});
		expect<unknown>(readPolicy(file({ formatVersion: "1" }))).toEqual({
			ok: false,
			error: "unknown-format",
		});
		expect<unknown>(readPolicy(file({ formatVersion: 2, extra: 1 }))).toEqual({
			ok: false,
			error: "unknown-format",
		});
	});

	test("null, an array and a string are not an object", () => {
		for (const value of [null, [], "policy", 1, undefined]) {
			expect<unknown>(readPolicy(value)).toEqual({
				ok: false,
				error: "not-an-object",
			});
		}
	});

	test("a remote is stored in its canonical form", () => {
		const read = readPolicy(
			file({
				rules: [{ remote: "git@GitHub.com:Me/Repo.git", mode: "allow" }],
			}),
		);
		expect<unknown>(read).toEqual({
			ok: true,
			value: policy([{ remote: "github.com/me/repo", mode: "allow" }]),
		});
	});

	test("a trailing slash on a directory is dropped, and the root stays", () => {
		const read = readPolicy(
			file({
				rules: [
					{ directory: "/work/app/", mode: "allow" },
					{ directory: "/", mode: "deny" },
				],
			}),
		);
		expect<unknown>(read).toEqual({
			ok: true,
			value: policy([
				{ directory: "/work/app", mode: "allow" },
				{ directory: "/", mode: "deny" },
			]),
		});
	});
});

describe("resolvePolicy", () => {
	const modeOf = (p: Policy, c: Call) => resolvePolicy(p, c).mode;

	test("with no rules the default mode applies", () => {
		for (const mode of ["deny", "confirm-each", "allow"] as const) {
			expect(resolvePolicy(policy([], mode), call())).toEqual({
				mode,
				vetoed: false,
				unattendedPostRead: false,
			});
		}
	});

	test("a scoped allow works under a default deny", () => {
		const p = policy([{ directory: "/work/app", mode: "allow" }]);
		expect(modeOf(p, call({ directory: "/work/app/src" }))).toBe("allow");
		expect(modeOf(p, call({ directory: "/work/app" }))).toBe("allow");
		expect(modeOf(p, call({ directory: "/work" }))).toBe("deny");
	});

	test("a rule for /work/app does not match /work/application", () => {
		const p = policy([{ directory: "/work/app", mode: "allow" }]);
		expect(modeOf(p, call({ directory: "/work/application" }))).toBe("deny");
		expect(modeOf(p, call({ directory: "/work/app-two/src" }))).toBe("deny");
	});

	test("a matching deny beats a matching allow, and confirm-each beats allow", () => {
		const denyDeep = policy(
			[
				{ directory: "/work", mode: "allow" },
				{ directory: "/work/app", mode: "deny" },
			],
			"allow",
		);
		expect(modeOf(denyDeep, call({ directory: "/work/app/src" }))).toBe("deny");
		const denyShallow = policy(
			[
				{ directory: "/work/app", mode: "allow" },
				{ directory: "/work", mode: "deny" },
			],
			"allow",
		);
		expect(modeOf(denyShallow, call({ directory: "/work/app/src" }))).toBe(
			"deny",
		);
		const confirmDeep = policy([
			{ directory: "/work", mode: "allow" },
			{ directory: "/work/app", mode: "confirm-each" },
		]);
		expect(modeOf(confirmDeep, call({ directory: "/work/app" }))).toBe(
			"confirm-each",
		);
		const mixed = policy([
			{ directory: "/work/app", mode: "allow" },
			{ remote: "github.com/me/repo", mode: "confirm-each" },
		]);
		expect(
			modeOf(mixed, call({ remotes: ["https://github.com/me/repo"] })),
		).toBe("confirm-each");
		const mixedDeny = policy([
			{ remote: "github.com/me/repo", mode: "deny" },
			{ directory: "/work/app", mode: "allow" },
		]);
		expect(
			modeOf(mixedDeny, call({ remotes: ["https://github.com/me/repo"] })),
		).toBe("deny");
		const confirmVsDeny = policy([
			{ directory: "/work", mode: "deny" },
			{ directory: "/work/app", mode: "confirm-each" },
		]);
		expect(modeOf(confirmVsDeny, call())).toBe("deny");
	});

	test("SSH and HTTPS forms of one remote match alike", () => {
		const read = readPolicy(
			file({
				rules: [{ remote: "https://github.com/me/repo", mode: "allow" }],
			}),
		);
		if (!read.ok) throw new Error("policy refused");
		for (const remote of [
			"git@github.com:me/repo.git",
			"git@GitHub.com:Me/Repo.git",
			"https://GitHub.com/Me/Repo.git",
			"ssh://git@github.com:22/me/repo",
			"github.com/me/repo",
		]) {
			expect(modeOf(read.value, call({ remotes: [remote] }))).toBe("allow");
		}
		expect(
			modeOf(read.value, call({ remotes: ["git@github.com:me/other.git"] })),
		).toBe("deny");
	});

	test("a repository with several remotes matches if any one matches", () => {
		const p = policy([{ remote: "github.com/me/repo", mode: "allow" }]);
		const remotes = [
			"git@gitlab.com:me/mirror.git",
			"not a remote",
			"git@github.com:me/repo.git",
		];
		expect(modeOf(p, call({ remotes }))).toBe("allow");
		expect(modeOf(p, call({ remotes: remotes.slice(0, 2) }))).toBe("deny");
		expect(modeOf(p, call({ remotes: [] }))).toBe("deny");
	});

	test("the root directory rule matches every call", () => {
		const p = policy([{ directory: "/", mode: "allow" }]);
		expect(modeOf(p, call({ directory: "/" }))).toBe("allow");
		expect(modeOf(p, call({ directory: "/anything/at/all" }))).toBe("allow");
	});

	test("a veto beats a matching allow", () => {
		const p = policy(
			[{ directory: "/", mode: "allow", unattendedPostRead: true }],
			"allow",
			true,
		);
		expect(resolvePolicy(p, call({ vetoed: true }))).toEqual({
			mode: "deny",
			vetoed: true,
			unattendedPostRead: false,
		});
		expect(resolvePolicy(p, call())).toEqual({
			mode: "allow",
			vetoed: false,
			unattendedPostRead: true,
		});
	});

	test("unattended post-read sends need the opt-in and no matching withhold", () => {
		const rule = (unattendedPostRead?: boolean): PolicyEntry =>
			unattendedPostRead === undefined
				? { directory: "/work", mode: "allow" }
				: { directory: "/work", mode: "allow", unattendedPostRead };
		const flag = (p: Policy, c: Call = call()) =>
			resolvePolicy(p, c).unattendedPostRead;
		// opted in, no rule says otherwise
		expect(flag(policy([rule()], "deny", true))).toBe(true);
		// not opted in
		expect(flag(policy([rule()], "deny", false))).toBe(false);
		// opted in, a matching rule withholds
		expect(flag(policy([rule(false)], "deny", true))).toBe(false);
		// not opted in: a matching rule's true does not switch it on
		expect(flag(policy([rule(true)], "deny", false))).toBe(false);
		// opted in, a rule that does not match withholds nothing
		expect(
			flag(
				policy([rule(false)], "deny", true),
				call({ directory: "/elsewhere" }),
			),
		).toBe(true);
		// opted in, one of two matching rules withholds
		expect(flag(policy([rule(true), rule(false)], "deny", true))).toBe(false);
	});

	test("the default mode does not apply when a rule matches", () => {
		const p = policy([{ directory: "/work/app", mode: "deny" }], "allow");
		expect(modeOf(p, call())).toBe("deny");
		expect(modeOf(p, call({ directory: "/elsewhere" }))).toBe("allow");
	});
});

describe("policyPermission", () => {
	const veto = {
		mode: "deny",
		vetoed: true,
		unattendedPostRead: false,
	} as const;
	const cells: [
		string,
		{ mode: PolicyMode; vetoed: boolean; unattendedPostRead: boolean },
		Permission,
		Permission,
	][] = [
		[
			"deny",
			{ mode: "deny", vetoed: false, unattendedPostRead: false },
			"yes",
			"no",
		],
		[
			"confirm-each",
			{ mode: "confirm-each", vetoed: false, unattendedPostRead: false },
			"needs-human",
			"needs-human",
		],
		[
			"allow",
			{ mode: "allow", vetoed: false, unattendedPostRead: false },
			"yes",
			"yes",
		],
		["veto", veto, "yes", "no"],
	];
	for (const [name, resolution, retraction, other] of cells) {
		test(`under ${name}: retraction is ${retraction}, other is ${other}`, () => {
			expect(policyPermission(resolution, "retraction")).toBe(retraction);
			expect(policyPermission(resolution, "other")).toBe(other);
		});
	}

	test("a veto refuses everything but a retraction whatever mode it carries", () => {
		for (const mode of ["deny", "confirm-each", "allow"] as const) {
			const resolution = { mode, vetoed: true, unattendedPostRead: false };
			expect(policyPermission(resolution, "retraction")).toBe("yes");
			expect(policyPermission(resolution, "other")).toBe("no");
		}
	});
});
