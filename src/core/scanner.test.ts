import { describe, expect, test } from "bun:test";
import {
	applyFixes,
	isMechanical,
	type ScanContext,
	SECRET_RULES,
	scanOutgoing,
} from "./scanner.ts";
import { fakeSecret, randomAlnum } from "./secret-fixtures.ts";

const EMPTY: ScanContext = {
	homeDirs: [],
	workDirs: [],
	userNames: [],
	hostNames: [],
	privateRemotes: [],
	nonDefaultBranches: [],
	privatePackageNames: [],
	env: [],
};

function context(overrides: Partial<ScanContext>): ScanContext {
	return { ...EMPTY, ...overrides };
}

/** The secret-shaped text for each rule, the part that must never be echoed, and a near-miss that is not a secret. */
const CASES: Record<
	string,
	{ draft: (secret: string) => string; secret: string; nearMiss: string }
> = {
	"private-key-block": {
		draft: (s) => `I pasted ${s} into the log`,
		secret: fakeSecret("private-key-block"),
		nearMiss: "the file starts with -----BEGIN PUBLIC KEY----- only",
	},
	"aws-access-key-id": {
		draft: (s) => `I pasted ${s} into the log`,
		secret: fakeSecret("aws-access-key-id"),
		nearMiss: `I pasted ${"AK" + "IA"}${randomAlnum(8).toUpperCase()} into the log`,
	},
	"github-token": {
		draft: (s) => `I pasted ${s} into the log`,
		secret: fakeSecret("github-token"),
		nearMiss: `I pasted ${"gh" + "p_"}${randomAlnum(10)} into the log`,
	},
	"slack-token": {
		draft: (s) => `I pasted ${s} into the log`,
		secret: fakeSecret("slack-token"),
		nearMiss: `I pasted ${"xo" + "xb-"}${randomAlnum(5)} into the log`,
	},
	"npm-token": {
		draft: (s) => `I pasted ${s} into the log`,
		secret: fakeSecret("npm-token"),
		nearMiss: `I pasted ${"np" + "m_"}${randomAlnum(20)} into the log`,
	},
	"api-key-prefix": {
		draft: (s) => `I pasted ${s} into the log`,
		secret: fakeSecret("api-key-prefix"),
		nearMiss: `I pasted ${"s" + "k-"}${randomAlnum(10)} into the log`,
	},
	jwt: {
		draft: (s) => `I pasted ${s} into the log`,
		secret: fakeSecret("jwt"),
		nearMiss: `I pasted ${"ey" + "J"}${randomAlnum(12)}.${randomAlnum(12)} into the log`,
	},
	"bearer-header": {
		draft: (s) => `the request sent Authorization: Bearer ${s} to the host`,
		secret: randomAlnum(24),
		nearMiss: `the request sent Authorization: Bearer ${randomAlnum(8)} to the host`,
	},
	"url-credentials": {
		draft: (s) => `I cloned https://deploy:${s}@example.test/repo.git today`,
		secret: randomAlnum(14),
		nearMiss: "I cloned https://example.test:8080/repo.git today",
	},
	"secret-assignment": {
		draft: (s) => `the config had password = ${s} in it`,
		secret: randomAlnum(16),
		nearMiss: "the config had password = x in it",
	},
};

describe("scanOutgoing secrets", () => {
	test("every rule but env-value has a case here", () => {
		expect(Object.keys(CASES)).toEqual(
			SECRET_RULES.filter((rule) => rule !== "env-value"),
		);
	});

	for (const [rule, { draft, secret, nearMiss }] of Object.entries(CASES)) {
		test(`${rule} refuses its secret and lets its near-miss through`, () => {
			expect<unknown>(scanOutgoing(draft(secret), EMPTY)).toEqual({
				outcome: "secret",
				rules: [rule],
			});
			expect<unknown>(scanOutgoing(nearMiss, EMPTY)).toEqual({
				outcome: "clean",
			});
		});
	}

	test("secret-assignment finds names inside longer identifiers and quoted keys", () => {
		const texts = [
			`export DB_PASSWORD=${randomAlnum(16)}`,
			`${"AWS_SECRET_" + "ACCESS_KEY"}=${randomAlnum(40)}`,
			`GITHUB_TOKEN=${randomAlnum(30)}`,
			`{"password": "${randomAlnum(16)}"}`,
			`{"api_key":"${randomAlnum(20)}"}`,
			`password = ${randomAlnum(16)}`,
		];
		for (const text of texts) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({
				outcome: "secret",
				rules: ["secret-assignment"],
			});
		}
		for (const text of [
			"token: short",
			"password = x",
			`password = ${randomAlnum(11)}`,
			`GITHUB_TOKEN=${randomAlnum(11)}`,
			"the password field is required",
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("private-key-block also matches the PGP block header", () => {
		const header = `${"-----BEGIN " + "PGP PRIV"}${"ATE KEY BL" + "OCK-----"}`;
		expect<unknown>(
			scanOutgoing(`it began ${header} and went on`, EMPTY),
		).toEqual({
			outcome: "secret",
			rules: ["private-key-block"],
		});
	});

	test("github-token also matches the fine-grained form", () => {
		const token = `${"github" + "_pat_"}${randomAlnum(60)}`;
		expect<unknown>(scanOutgoing(`see ${token} here`, EMPTY)).toEqual({
			outcome: "secret",
			rules: ["github-token"],
		});
	});

	test("the rule list names every rule once, in order", () => {
		expect(SECRET_RULES).toEqual([
			"private-key-block",
			"aws-access-key-id",
			"github-token",
			"slack-token",
			"npm-token",
			"api-key-prefix",
			"jwt",
			"bearer-header",
			"url-credentials",
			"secret-assignment",
			"env-value",
		]);
	});

	test("a secret result carries rule names only", () => {
		const value = randomAlnum(24);
		const env = [{ name: "DEPLOY_TOKEN", value }];
		const runs: [string, ScanContext][] = Object.values(CASES).map(
			({ draft, secret }) => [draft(secret), EMPTY],
		);
		runs.push([`I pasted ${value} here`, context({ env })]);
		const secrets = [
			...Object.values(CASES).map(({ secret }) => secret),
			value,
		];
		expect(runs.length).toBe(secrets.length);
		runs.forEach(([text, ctx], index) => {
			const result = scanOutgoing(text, ctx);
			expect(result.outcome).toBe("secret");
			const json = JSON.stringify(result);
			const secret = secrets[index] ?? "";
			expect(secret.length).toBeGreaterThanOrEqual(8);
			for (let at = 0; at + 8 <= secret.length; at += 1) {
				expect(json.includes(secret.slice(at, at + 8))).toBe(false);
			}
			expect(Object.keys(result).sort()).toEqual(["outcome", "rules"]);
		});
	});

	test("a secret wins over context", () => {
		const text = `see /home/u/app/x.ts and ${fakeSecret("github-token")}`;
		const result = scanOutgoing(
			text,
			context({ homeDirs: ["/home/u"], userNames: ["alice"] }),
		);
		expect<unknown>(result).toEqual({
			outcome: "secret",
			rules: ["github-token"],
		});
	});

	test("rule names come back sorted", () => {
		const text = `${fakeSecret("npm-token")} and ${fakeSecret("aws-access-key-id")} and ${fakeSecret("github-token")}`;
		expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({
			outcome: "secret",
			rules: ["aws-access-key-id", "github-token", "npm-token"],
		});
	});
});

describe("the env-value rule", () => {
	test("the env-value rule uses secret-named and high-entropy values and skips standard variables", () => {
		const named = randomAlnum(8);
		const short = randomAlnum(7);
		const random = randomAlnum(20);
		const standard = randomAlnum(30);
		const secret = { outcome: "secret", rules: ["env-value"] };

		// a secret-named variable of 8 characters is found in the text
		expect<unknown>(
			scanOutgoing(
				`it printed ${named} once`,
				context({ env: [{ name: "DEPLOY_TOKEN", value: named }] }),
			),
		).toEqual(secret);
		// a 7-character one is not
		expect<unknown>(
			scanOutgoing(
				`it printed ${short} once`,
				context({ env: [{ name: "DEPLOY_TOKEN", value: short }] }),
			),
		).toEqual({ outcome: "clean" });
		// a 20-character random value is found under any name
		expect<unknown>(
			scanOutgoing(
				`it printed ${random} once`,
				context({ env: [{ name: "BUILD_ID", value: random }] }),
			),
		).toEqual(secret);
		// PATH and LC_ALL values never are
		for (const name of ["PATH", "LC_ALL"]) {
			expect<unknown>(
				scanOutgoing(
					`it printed ${standard} once`,
					context({ env: [{ name, value: standard }] }),
				),
			).toEqual({ outcome: "clean" });
		}
		// a value that does not occur in the text is not a hit
		expect<unknown>(
			scanOutgoing(
				"it printed nothing of the kind",
				context({ env: [{ name: "DEPLOY_TOKEN", value: random }] }),
			),
		).toEqual({ outcome: "clean" });
	});

	test("the secret name segments and pairs are recognised", () => {
		for (const name of [
			"AUTH_TOKEN",
			"MY_API_KEY",
			"GH_TOKEN",
			"db_password",
			"APP_SECRET",
			"X_CREDENTIALS",
			"SIGNING_PASSPHRASE",
			"PRIVATE_KEY",
		]) {
			const value = randomAlnum(8);
			expect<unknown>(
				scanOutgoing(
					`it printed ${value} once`,
					context({ env: [{ name, value }] }),
				),
			).toEqual({ outcome: "secret", rules: ["env-value"] });
		}
	});

	test("GIT_AUTHOR_NAME and SSH_AUTH_SOCK are not secret-named", () => {
		const author = randomAlnum(24);
		expect<unknown>(
			scanOutgoing(
				`the commit was authored by ${author} last week`,
				context({ env: [{ name: "GIT_AUTHOR_NAME", value: author }] }),
			),
		).toEqual({ outcome: "clean" });
		const socket = randomAlnum(24);
		expect<unknown>(
			scanOutgoing(
				`the agent answered on ${socket} again`,
				context({ env: [{ name: "SSH_AUTH_SOCK", value: socket }] }),
			),
		).toEqual({ outcome: "clean" });
		// neither name holds a secret segment: AUTHOR is not AUTH, MONKEY is not KEY
		for (const name of ["GIT_AUTHOR_DATE", "MONKEY_PATCH"]) {
			expect<unknown>(
				scanOutgoing(
					"the patch said aaaaaaaaaa twice",
					context({ env: [{ name, value: "aaaaaaaaaa" }] }),
				),
			).toEqual({ outcome: "clean" });
		}
		// but AUTH_TOKEN of 8 or more characters occurring in the text is
		const token = randomAlnum(10);
		expect<unknown>(
			scanOutgoing(
				`it printed ${token} once`,
				context({ env: [{ name: "AUTH_TOKEN", value: token }] }),
			),
		).toEqual({ outcome: "secret", rules: ["env-value"] });
	});

	test("a high-entropy path or URL value is not an env-value hit", () => {
		for (const value of [
			`/${randomAlnum(30)}`,
			`~/${randomAlnum(30)}`,
			`https://example.test/${randomAlnum(30)}`,
		]) {
			expect<unknown>(
				scanOutgoing(
					`it printed ${value} once`,
					context({ env: [{ name: "BUILD_DIR", value }] }),
				),
			).toEqual({ outcome: "clean" });
		}
	});

	test("a low-entropy long value is not a hit unless its name is secret", () => {
		const value = "a".repeat(30);
		expect<unknown>(
			scanOutgoing(
				`it printed ${value} once`,
				context({ env: [{ name: "BUILD_ID", value }] }),
			),
		).toEqual({ outcome: "clean" });
	});

	test("an empty value never matches", () => {
		expect<unknown>(
			scanOutgoing(
				"nothing here",
				context({ env: [{ name: "API_KEY", value: "" }] }),
			),
		).toEqual({ outcome: "clean" });
	});
});

describe("scanOutgoing context", () => {
	test("home and work directories get their fixed fixes", () => {
		const text = "see /home/u/app/src/x.ts and /home/u/.npmrc";
		const result = scanOutgoing(
			text,
			context({ homeDirs: ["/home/u"], workDirs: ["/home/u/app"] }),
		);
		expect<unknown>(result).toEqual({
			outcome: "context",
			findings: [
				{ kind: "work-dir", span: { start: 4, end: 15 }, fix: "<workspace>" },
				{ kind: "home-dir", span: { start: 29, end: 36 }, fix: "~" },
			],
		});
		if (result.outcome !== "context") throw new Error("not context");
		expect(isMechanical(result.findings)).toBe(true);
		expect(applyFixes(text, result.findings)).toBe(
			"see <workspace>/src/x.ts and ~/.npmrc",
		);
	});

	test("a user name is matched on word boundaries and has no fix", () => {
		const ctx = context({ userNames: ["alice"] });
		for (const text of ["alice reported", "by Alice"]) {
			const result = scanOutgoing(text, ctx);
			expect(result.outcome).toBe("context");
			if (result.outcome !== "context") throw new Error("not context");
			expect(result.findings.map((finding) => finding.kind)).toEqual([
				"user-name",
			]);
			expect(isMechanical(result.findings)).toBe(false);
			expect(applyFixes(text, result.findings)).toBe(text);
		}
		for (const text of [
			"malice",
			"alicenet",
			"alice_two",
			"alice_b",
			"_alice",
		]) {
			expect<unknown>(scanOutgoing(text, ctx)).toEqual({ outcome: "clean" });
		}
	});

	test("a name ends at a sentence dot, a host dot or a hyphen (R2: only letters, digits and underscore bound it)", () => {
		const cases: [Partial<ScanContext>, string, string][] = [
			[{ userNames: ["alice"] }, "thanks, alice.", "alice"],
			[{ hostNames: ["box7"] }, "it ran on box7.", "box7"],
			[{ hostNames: ["box7"] }, "ssh box7.local", "box7"],
			[
				{ nonDefaultBranches: ["feature/login"] },
				"I pushed feature/login.",
				"feature/login",
			],
			[{ userNames: ["alice"] }, "ping alice-dev", "alice"],
			[{ userNames: ["alice"] }, "alice.b", "alice"],
			[{ userNames: ["alice"] }, "my-alice", "alice"],
		];
		for (const [overrides, text, name] of cases) {
			const start = text.indexOf(name);
			const result = scanOutgoing(text, context(overrides));
			if (result.outcome !== "context") throw new Error(`not context: ${text}`);
			expect(result.findings.map((finding) => finding.span)).toEqual([
				{ start, end: start + name.length },
			]);
		}
	});

	test("host names, branches and private packages are located by name", () => {
		const text = "box7 pushed feature/login with @me/internal-lib";
		const result = scanOutgoing(
			text,
			context({
				hostNames: ["box7"],
				nonDefaultBranches: ["feature/login"],
				privatePackageNames: ["@me/internal-lib"],
			}),
		);
		expect<unknown>(result).toEqual({
			outcome: "context",
			findings: [
				{ kind: "host-name", span: { start: 0, end: 4 } },
				{ kind: "branch", span: { start: 12, end: 25 } },
				{ kind: "private-package", span: { start: 31, end: 47 } },
			],
		});
	});

	test("a private remote is found in the URL and the scp forms", () => {
		const ctx = context({ privateRemotes: ["github.com/me/private"] });
		const url = "cloned https://github.com/Me/Private.git today";
		const scp = "cloned git@github.com:me/private today";
		expect<unknown>(scanOutgoing(url, ctx)).toEqual({
			outcome: "context",
			findings: [
				{
					kind: "private-remote",
					span: {
						start: url.indexOf("github.com"),
						end: url.indexOf("github.com") + "github.com/me/private".length,
					},
				},
			],
		});
		expect<unknown>(scanOutgoing(scp, ctx)).toEqual({
			outcome: "context",
			findings: [
				{
					kind: "private-remote",
					span: {
						start: scp.indexOf("github.com"),
						end: scp.indexOf("github.com") + "github.com:me/private".length,
					},
				},
			],
		});
		expect<unknown>(scanOutgoing("cloned github.com/me/public", ctx)).toEqual({
			outcome: "clean",
		});
	});

	test("findings are sorted and do not overlap", () => {
		const text =
			"alice ran /home/u/app/x on box7 for github.com/me/private, again /home/u";
		const result = scanOutgoing(
			text,
			context({
				homeDirs: ["/home/u"],
				workDirs: ["/home/u/app"],
				userNames: ["alice"],
				hostNames: ["box7"],
				privateRemotes: ["github.com/me/private"],
			}),
		);
		if (result.outcome !== "context") throw new Error("not context");
		expect(result.findings.map((finding) => finding.kind)).toEqual([
			"user-name",
			"work-dir",
			"host-name",
			"private-remote",
			"home-dir",
		]);
		let previousEnd = 0;
		for (const finding of result.findings) {
			if (finding.span === null)
				throw new Error("unexpected unlocated finding");
			expect(finding.span.start).toBeGreaterThanOrEqual(previousEnd);
			expect(finding.span.end).toBeGreaterThan(finding.span.start);
			previousEnd = finding.span.end;
		}
	});

	test("hits of equal start and length are ordered by kind name", () => {
		const result = scanOutgoing(
			"hello alice there",
			context({ userNames: ["alice"], hostNames: ["alice"] }),
		);
		expect<unknown>(result).toEqual({
			outcome: "context",
			findings: [{ kind: "host-name", span: { start: 6, end: 11 } }],
		});
	});

	test("a directory ends at a path boundary", () => {
		const home = context({ homeDirs: ["/home/u"] });
		for (const text of [
			"see /home/user/x",
			"see /home/u.cfg",
			"see /home/u-old",
		]) {
			expect<unknown>(scanOutgoing(text, home)).toEqual({ outcome: "clean" });
		}
		expect<unknown>(
			scanOutgoing(
				"see /home/u/app2/x",
				context({ workDirs: ["/home/u/app"] }),
			),
		).toEqual({ outcome: "clean" });
		for (const text of [
			"see /home/u/x",
			"see /home/u",
			"see /home/u.",
			'"/home/u"',
			"/home/u/",
		]) {
			const result = scanOutgoing(text, home);
			if (result.outcome !== "context") throw new Error(`not context: ${text}`);
			expect(
				result.findings.map((finding) => [finding.kind, finding.fix]),
			).toEqual([["home-dir", "~"]]);
			expect(applyFixes(text, result.findings)).toBe(
				text.replace("/home/u", "~"),
			);
		}
	});

	test("trailing slashes of a directory entry are ignored", () => {
		const home = scanOutgoing(
			"see /home/u/foo",
			context({ homeDirs: ["/home/u/"] }),
		);
		expect<unknown>(home).toEqual({
			outcome: "context",
			findings: [{ kind: "home-dir", span: { start: 4, end: 11 }, fix: "~" }],
		});
		if (home.outcome !== "context") throw new Error("not context");
		expect(applyFixes("see /home/u/foo", home.findings)).toBe("see ~/foo");
		expect<unknown>(
			scanOutgoing(
				"see /home/u/app/src",
				context({ workDirs: ["/home/u/app//"] }),
			),
		).toEqual({
			outcome: "context",
			findings: [
				{ kind: "work-dir", span: { start: 4, end: 15 }, fix: "<workspace>" },
			],
		});
	});

	test("the entry / alone matches a slash followed by a boundary", () => {
		const root = context({ homeDirs: ["/"] });
		expect<unknown>(scanOutgoing("see /home/u", root)).toEqual({
			outcome: "clean",
		});
		expect<unknown>(scanOutgoing("the root / is full", root)).toEqual({
			outcome: "context",
			findings: [{ kind: "home-dir", span: { start: 9, end: 10 }, fix: "~" }],
		});
		// slashes only: the same entry
		expect<unknown>(
			scanOutgoing("the root / is full", context({ homeDirs: ["//"] })),
		).toEqual({
			outcome: "context",
			findings: [{ kind: "home-dir", span: { start: 9, end: 10 }, fix: "~" }],
		});
	});

	test("a hit that reaches past a kept finding takes its fix away", () => {
		const text = "cd /home/u/wip-x now";
		const result = scanOutgoing(
			text,
			context({ homeDirs: ["/home/u"], nonDefaultBranches: ["u/wip-x"] }),
		);
		expect<unknown>(result).toEqual({
			outcome: "context",
			findings: [{ kind: "home-dir", span: { start: 3, end: 10 } }],
		});
		if (result.outcome !== "context") throw new Error("not context");
		expect(isMechanical(result.findings)).toBe(false);
		expect(applyFixes(text, result.findings)).toBe(text);
	});

	test("a hit wholly inside a kept finding changes nothing", () => {
		const text = "cd /home/u/app/x now";
		const result = scanOutgoing(
			text,
			context({
				homeDirs: ["/home/u"],
				workDirs: ["/home/u/app"],
				userNames: ["u"],
				nonDefaultBranches: ["home"],
			}),
		);
		expect<unknown>(result).toEqual({
			outcome: "context",
			findings: [
				{ kind: "work-dir", span: { start: 3, end: 14 }, fix: "<workspace>" },
			],
		});
	});

	test("a look-alike user name is found without a span", () => {
		const text = "by \uff41\uff4c\uff49\uff43\uff45 yesterday";
		const result = scanOutgoing(text, context({ userNames: ["alice"] }));
		expect<unknown>(result).toEqual({
			outcome: "context",
			findings: [{ kind: "user-name", span: null }],
		});
		if (result.outcome !== "context") throw new Error("not context");
		expect(isMechanical(result.findings)).toBe(false);
		expect(applyFixes(text, result.findings)).toBe(text);
	});

	test("unlocated findings come after the located ones", () => {
		const text = "alice and \uff41\uff4c\uff49\uff43\uff45 in /home/u";
		const result = scanOutgoing(
			text,
			context({ userNames: ["alice"], homeDirs: ["/home/u"] }),
		);
		if (result.outcome !== "context") throw new Error("not context");
		expect(
			result.findings.map((finding) => [finding.kind, finding.span === null]),
		).toEqual([
			["user-name", false],
			["home-dir", false],
			["user-name", true],
		]);
	});

	test("an upper-case name is located on the raw text", () => {
		const text = "reported by ALICE today";
		expect<unknown>(
			scanOutgoing(text, context({ userNames: ["alice"] })),
		).toEqual({
			outcome: "context",
			findings: [{ kind: "user-name", span: { start: 12, end: 17 } }],
		});
		// the ligature folds to two letters, so folded offsets would be one too far
		const ligature = "the \ufb01le is from ALICE";
		const at = ligature.indexOf("ALICE");
		expect<unknown>(
			scanOutgoing(ligature, context({ userNames: ["alice"] })),
		).toEqual({
			outcome: "context",
			findings: [{ kind: "user-name", span: { start: at, end: at + 5 } }],
		});
	});

	test("a clean text is clean", () => {
		expect<unknown>(
			scanOutgoing(
				"left-pad 1.3.0 fails to install when the lock file is stale",
				context({
					homeDirs: ["/home/u"],
					userNames: ["alice"],
					hostNames: ["box7"],
					privateRemotes: ["github.com/me/private"],
				}),
			),
		).toEqual({ outcome: "clean" });
	});

	test("names under the minimum length are ignored", () => {
		expect<unknown>(
			scanOutgoing("al was here, al again", context({ userNames: ["al"] })),
		).toEqual({ outcome: "clean" });
	});

	test("an empty context finds only secrets", () => {
		expect<unknown>(
			scanOutgoing("see /home/u/app/x.ts by alice on box7", EMPTY),
		).toEqual({ outcome: "clean" });
		expect<unknown>(
			scanOutgoing(`see ${fakeSecret("npm-token")}`, EMPTY),
		).toEqual({ outcome: "secret", rules: ["npm-token"] });
	});
});

describe("applyFixes and isMechanical", () => {
	test("applyFixes leaves a finding without a fix in place and fixes the rest", () => {
		const text = "alice at /home/u/x";
		const result = scanOutgoing(
			text,
			context({ userNames: ["alice"], homeDirs: ["/home/u"] }),
		);
		if (result.outcome !== "context") throw new Error("not context");
		expect(isMechanical(result.findings)).toBe(false);
		expect(applyFixes(text, result.findings)).toBe("alice at ~/x");
	});

	test("an empty list is mechanical and changes nothing", () => {
		expect(isMechanical([])).toBe(true);
		expect(applyFixes("unchanged", [])).toBe("unchanged");
	});
});
