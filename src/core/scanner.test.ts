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
	"cookie-header": {
		draft: (s) => `the request sent Cookie: session=${s} to the host`,
		secret: randomAlnum(24),
		nearMiss: "the request sent Cookie: a=b to the host",
	},
	"docker-auth": {
		draft: (s) => `the config had "auth": "${s}" in it`,
		secret: `${randomAlnum(24)}==`,
		nearMiss: 'the config had "auth": "short" in it',
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

	test("bearer-header covers the Token and Digest schemes (R21)", () => {
		for (const text of [
			`Authorization: Token ${randomAlnum(30)}`,
			`Authorization: Digest ${randomAlnum(30)}`,
			`Proxy-Authorization: token ${randomAlnum(30)}`,
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({
				outcome: "secret",
				rules: ["bearer-header"],
			});
		}
		for (const text of [
			"Authorization: Token abc",
			"the Token scheme is described in RFC 6750",
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("url-credentials covers a token used as the username of a URL (R22)", () => {
		expect<unknown>(
			scanOutgoing(
				`git clone https://${randomAlnum(30)}@gitlab.com/org/repo`,
				EMPTY,
			),
		).toEqual({ outcome: "secret", rules: ["url-credentials"] });
		expect<unknown>(
			scanOutgoing(`see https://${randomAlnum(20)}@host.test/x`, EMPTY),
		).toEqual({ outcome: "secret", rules: ["url-credentials"] });
		for (const text of [
			"git clone https://git@github.com/org/repo",
			"ssh://git@host/path",
			`see https://${randomAlnum(19)}@host.test/x`,
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("secret-assignment accepts a quoted value that contains spaces (R23)", () => {
		for (const text of [
			'password: "correct horse battery staple"',
			"secret = 'my long passphrase here'",
			'{"password": "two words here ok"}',
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({
				outcome: "secret",
				rules: ["secret-assignment"],
			});
		}
		for (const text of [
			'password: "short one"',
			"the password field is required",
			'password: "x"',
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("url-credentials covers base64 characters in a colon-less userinfo (R26)", () => {
		for (const userinfo of [
			`${randomAlnum(29)}=`,
			`${randomAlnum(28)}==`,
			`${randomAlnum(14)}+${randomAlnum(15)}`,
			randomAlnum(30),
		]) {
			expect<unknown>(
				scanOutgoing(
					`git clone https://${userinfo}@gitlab.com/org/repo`,
					EMPTY,
				),
			).toEqual({ outcome: "secret", rules: ["url-credentials"] });
		}
		for (const text of [
			`git clone https://${randomAlnum(19)}@gitlab.com/org/repo`,
			`git clone https://${randomAlnum(18)}=@gitlab.com/org/repo`,
			"git clone https://git@github.com/org/repo",
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("bearer-header covers the ApiKey, Api-Key, Negotiate and NTLM schemes (R27)", () => {
		const hex = Array.from({ length: 40 }, () =>
			"0123456789abcdef".charAt(Math.floor(Math.random() * 16)),
		).join("");
		for (const text of [
			`Authorization: ApiKey ${hex}`,
			`Authorization: Api-Key ${hex}`,
			`Authorization: Negotiate ${randomAlnum(30)}==`,
			`Authorization: NTLM ${randomAlnum(30)}==`,
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({
				outcome: "secret",
				rules: ["bearer-header"],
			});
		}
		for (const text of [
			"Authorization: ApiKey abc",
			"the ApiKey scheme is documented elsewhere",
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("secret-assignment covers passphrase (R28)", () => {
		for (const text of [
			'passphrase: "correct horse battery staple"',
			`passphrase = ${randomAlnum(20)}`,
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({
				outcome: "secret",
				rules: ["secret-assignment"],
			});
		}
		for (const text of ["passphrase = x", "the passphrase is required"]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("cookie-header finds a cookie with a long value (R29)", () => {
		const cases: [string, string[]][] = [
			[`Cookie: session=${randomAlnum(30)}`, ["cookie-header"]],
			[`Set-Cookie: sid=${randomAlnum(24)}; Path=/`, ["cookie-header"]],
			// the name "token" also trips secret-assignment, so both rules report, sorted by name
			[
				`cookie : token=${randomAlnum(20)}`,
				["cookie-header", "secret-assignment"],
			],
		];
		for (const [text, rules] of cases) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({
				outcome: "secret",
				rules,
			});
		}
		for (const text of [
			"Cookie: a=b",
			"the cookie banner was shown",
			"Cookie: ",
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("ordinary sentences about these headers stay clean", () => {
		for (const text of [
			"The Authorization header uses the Token scheme, see RFC 7235",
			"Use Authorization: Bearer <your token here> in requests",
			"git clone https://github.com/org/repo and https://user@github.com/org/repo",
			"the cookie header is set by the server",
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("url-credentials accepts an empty user before the colon (R30)", () => {
		for (const text of [
			`redis://:${randomAlnum(20)}@localhost:6379/0`,
			`http://:${randomAlnum(12)}@host/`,
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({
				outcome: "secret",
				rules: ["url-credentials"],
			});
		}
		for (const text of [
			"curl http://localhost:8080/path and https://host:443/a@b",
			"https://github.com/org/repo",
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("secret-assignment covers credential, account key and shared access key names (R31a)", () => {
		for (const text of [
			`credential: "${randomAlnum(32)}"`,
			`credentials = ${randomAlnum(20)}`,
			`DefaultEndpointsProtocol=https;AccountName=myacc;AccountKey=${randomAlnum(30)}==;EndpointSuffix=core.windows.net`,
			`SharedAccessKey=${randomAlnum(30)}`,
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({
				outcome: "secret",
				rules: ["secret-assignment"],
			});
		}
		for (const text of [
			"credential: invalid",
			"the credentials are required",
			"auth: authentication failed",
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("docker-auth finds the auth field of a Docker config (R31b)", () => {
		const config = `{"auths": {"https://index.docker.io/v1/": {"auth": "${randomAlnum(24)}=="}}}`;
		expect<unknown>(scanOutgoing(config, EMPTY)).toEqual({
			outcome: "secret",
			rules: ["docker-auth"],
		});
		for (const text of ['"auth": "short"', '{"auth": true}']) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("api-key-prefix covers more provider key formats (R32)", () => {
		const samples: [string, string][] = [
			[
				`${"S" + "G."}${randomAlnum(22)}.${randomAlnum(22)}`,
				`${"S" + "G."}${randomAlnum(10)}.${randomAlnum(22)}`,
			],
			[
				`${"r" + "k_live_"}${randomAlnum(24)}`,
				`${"r" + "k_live_"}${randomAlnum(8)}`,
			],
			[
				`${"s" + "k_test_"}${randomAlnum(24)}`,
				`${"s" + "k_test_"}${randomAlnum(8)}`,
			],
			[
				`${"gl" + "pat-"}${randomAlnum(24)}`,
				`${"gl" + "pat-"}${randomAlnum(8)}`,
			],
			[
				`${"py" + "pi-AgEI"}${randomAlnum(40)}`,
				`${"py" + "pi-AgEI"}${randomAlnum(8)}`,
			],
			[`${"h" + "f_"}${randomAlnum(34)}`, `${"h" + "f_"}${randomAlnum(10)}`],
			[
				`${"do" + "p_v1_"}${randomAlnum(40)}`,
				`${"do" + "p_v1_"}${randomAlnum(8)}`,
			],
			[
				`${"sh" + "pat_"}${randomAlnum(32)}`,
				`${"sh" + "pat_"}${randomAlnum(8)}`,
			],
			[
				`${"sh" + "pss_"}${randomAlnum(32)}`,
				`${"sh" + "pxx_"}${randomAlnum(32)}`,
			],
		];
		for (const [secret, nearMiss] of samples) {
			expect<unknown>(scanOutgoing(`I pasted ${secret} here`, EMPTY)).toEqual({
				outcome: "secret",
				rules: ["api-key-prefix"],
			});
			expect<unknown>(scanOutgoing(`I pasted ${nearMiss} here`, EMPTY)).toEqual(
				{ outcome: "clean" },
			);
		}
	});

	test("cookie-header skips the standard cookie attribute names (R33)", () => {
		for (const text of [
			"Set-Cookie: path=/api/v2/organizations/settings",
			"Cookie: domain=subdomain.example.com",
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
		for (const text of [
			`Set-Cookie: sid=${randomAlnum(24)}; Path=/`,
			`Cookie: session=${randomAlnum(30)}`,
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({
				outcome: "secret",
				rules: ["cookie-header"],
			});
		}
	});

	test("cookie-header looks at every pair on the header line (R34)", () => {
		const hex = (count: number) =>
			Array.from({ length: count }, () =>
				"0123456789abcdef".charAt(Math.floor(Math.random() * 16)),
			).join("");
		for (const text of [
			`Cookie: lang=en; session=${hex(32)}`,
			`Cookie: a=1; b=2; auth=${hex(32)}; c=3`,
			`Set-Cookie: theme=dark; sid=${randomAlnum(24)}; Path=/`,
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({
				outcome: "secret",
				rules: ["cookie-header"],
			});
		}
		for (const text of [
			"Cookie: lang=en; theme=dark",
			"Set-Cookie: path=/api/v2/organizations/settings",
			"Cookie: domain=subdomain.example.com; path=/",
			"the cookie banner was shown; x=1234567890123456",
			"Cookie: session",
			"the cookie header is set by the server",
		]) {
			expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
		}
	});

	test("cookie-header does not backtrack badly on long input (R34)", () => {
		for (const text of [
			`Cookie: ${"a".repeat(200000)}`,
			`cookie:${"a=".repeat(100000)}`,
		]) {
			const started = performance.now();
			scanOutgoing(text, EMPTY);
			expect(performance.now() - started).toBeLessThan(2000);
		}
	});

	test("ordinary technical text stays clean", () => {
		const sha = Array.from({ length: 40 }, () =>
			"0123456789abcdef".charAt(Math.floor(Math.random() * 16)),
		).join("");
		for (const text of [
			`fixed in commit ${sha} on main`,
			`the id is ${crypto.randomUUID()} in the log`,
			"curl http://localhost:8080/path",
			"see /home/user/project/src/index.ts line 12",
			"version 1.2.3-beta.4+build.5",
			"error: token expired",
			"The Authorization header uses the Token scheme, see RFC 7235",
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
			"cookie-header",
			"docker-auth",
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

	test("a private remote is found after an underscore, as in markdown emphasis (R24)", () => {
		const ctx = context({ privateRemotes: ["github.com/me/private"] });
		for (const text of [
			"_github.com/me/private_",
			"see_github.com/me/private",
		]) {
			const result = scanOutgoing(text, ctx);
			if (result.outcome !== "context") throw new Error(`not context: ${text}`);
			expect(result.findings).toHaveLength(1);
			expect(result.findings[0]?.kind).toBe("private-remote");
			const start = text.indexOf("github.com");
			expect<unknown>(result.findings[0]?.span).toEqual({
				start,
				end: start + "github.com/me/private".length,
			});
		}
		expect<unknown>(scanOutgoing("xgithub.com/me/private", ctx)).toEqual({
			outcome: "clean",
		});
	});

	test("a private remote is found with a port, with host:/path and in any case", () => {
		const ctx = context({
			privateRemotes: ["git.corp.example/team/secret-repo"],
		});
		for (const remote of [
			"ssh://git@git.corp.example:2222/team/secret-repo.git",
			"https://git.corp.example:8443/team/secret-repo",
			"git@git.corp.example:/team/secret-repo.git",
			"git@git.corp.example:team/secret-repo.git",
			"https://git.corp.example/team/secret-repo",
			"https://GIT.Corp.Example:443/Team/Secret-Repo.git",
		]) {
			const text = `clone ${remote} now`;
			const result = scanOutgoing(text, ctx);
			if (result.outcome !== "context") throw new Error(`not context: ${text}`);
			expect(result.findings).toHaveLength(1);
			const finding = result.findings[0];
			expect(finding?.kind).toBe("private-remote");
			expect(finding?.fix).toBeUndefined();
			const span = finding?.span;
			if (span === null || span === undefined) throw new Error("no span");
			expect(text.slice(span.start, span.end).toLowerCase()).toStartWith(
				"git.corp.example",
			);
			expect(text.slice(span.start, span.end).toLowerCase()).toContain(
				"team/secret-repo",
			);
		}
	});

	test("a longer host that contains the remote's host is not a private remote", () => {
		const ctx = context({
			privateRemotes: ["git.corp.example/team/secret-repo"],
		});
		for (const text of [
			"clone xgit.corp.example/team/secret-repo",
			"clone https://xgit.corp.example:2222/team/secret-repo",
			"clone git.corp.example.evil/team/secret-repo",
			"clone git@git.corp.example.evil:team/secret-repo",
			"clone sub.git.corp.example/team/secret-repo",
			"clone git.corp.example:abc/team/secret-repo",
			"clone git.corp.example/team/other-repo",
		]) {
			expect<unknown>(scanOutgoing(text, ctx)).toEqual({ outcome: "clean" });
		}
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

	test("a directory entry that is only slashes is ignored", () => {
		for (const entry of ["/", "//", "///"]) {
			for (const ctx of [
				context({ homeDirs: [entry] }),
				context({ workDirs: [entry] }),
			]) {
				for (const text of [
					"see /home/u",
					"the root / is full",
					"see https://example.com/a",
				]) {
					expect<unknown>(scanOutgoing(text, ctx)).toEqual({
						outcome: "clean",
					});
				}
			}
		}
		// another entry beside it still works
		expect<unknown>(
			scanOutgoing(
				"see /home/u/x",
				context({ homeDirs: ["/", "/home/u"], workDirs: ["/"] }),
			),
		).toEqual({
			outcome: "context",
			findings: [{ kind: "home-dir", span: { start: 4, end: 11 }, fix: "~" }],
		});
	});

	test("a directory hit needs a path boundary before it", () => {
		const ctx = context({ homeDirs: ["/home/u"] });
		expect<unknown>(
			scanOutgoing("copied from /mnt/backup/home/u/notes.txt", ctx),
		).toEqual({ outcome: "clean" });
		for (const before of ["a", "Z", "0", "_", ".", "-"]) {
			expect<unknown>(scanOutgoing(`x${before}/home/u/y`, ctx)).toEqual({
				outcome: "clean",
			});
		}
		const found = (text: string, start: number) =>
			expect<unknown>(scanOutgoing(text, ctx)).toEqual({
				outcome: "context",
				findings: [
					{ kind: "home-dir", span: { start, end: start + 7 }, fix: "~" },
				],
			});
		found("/home/u", 0);
		found("see /home/u/x", 4);
		found('"/home/u"', 1);
		found("(/home/u)", 1);
		found("file:///home/u/x", 7);
		found("cd\n/home/u", 3);
	});

	test("a tilde before a directory is not part of a path word (R35)", () => {
		const ctx = context({ homeDirs: ["/home/alice"] });
		const tilde = scanOutgoing("I checked in ~/home/alice/file.ts", ctx);
		if (tilde.outcome !== "context") throw new Error("not context");
		expect(tilde.findings.map((finding) => finding.kind)).toEqual(["home-dir"]);
		// a fix must not leave a path that the scan still flags without being able to fix it
		const text = "/home/alice/home/alice";
		const first = scanOutgoing(text, ctx);
		if (first.outcome !== "context") throw new Error("not context");
		expect(isMechanical(first.findings)).toBe(true);
		const fixed = applyFixes(text, first.findings);
		expect<unknown>(scanOutgoing(fixed, ctx)).not.toEqual({ outcome: "clean" });
	});

	test("a percent-encoded directory is a finding without a fix (R36)", () => {
		const ctx = context({ homeDirs: ["/home/alice"] });
		for (const encoded of ["%2Fhome%2Falice", "%2fhome%2falice"]) {
			const text = `https://gitlab.com/api?path=${encoded}%2Fproject`;
			const start = text.indexOf("%2");
			const result = scanOutgoing(text, ctx);
			expect<unknown>(result).toEqual({
				outcome: "context",
				findings: [
					{
						kind: "home-dir",
						span: { start, end: start + encoded.length },
					},
				],
			});
			if (result.outcome !== "context") throw new Error("not context");
			expect(isMechanical(result.findings)).toBe(false);
		}
		expect<unknown>(
			scanOutgoing("https://gitlab.com/api?path=%2Fhome%2Falicia", ctx),
		).toEqual({ outcome: "clean" });
		expect<unknown>(
			scanOutgoing("https://gitlab.com/api?path=%2Fmnt%2Fhome%2Falice", ctx),
		).toEqual({ outcome: "clean" });
		expect<unknown>(scanOutgoing("see /home/alice/x", ctx)).toEqual({
			outcome: "context",
			findings: [{ kind: "home-dir", span: { start: 4, end: 15 }, fix: "~" }],
		});
		// a work directory is matched the same way
		expect<unknown>(
			scanOutgoing("q=%2Fsrv%2Fapp", context({ workDirs: ["/srv/app"] })),
		).toEqual({
			outcome: "context",
			findings: [{ kind: "work-dir", span: { start: 2, end: 14 } }],
		});
		// a plain and an encoded hit together: both are found, in order, only the plain one has a fix
		const both = "cd /home/alice then ?p=%2Fhome%2Falice";
		const encodedStart = both.indexOf("%2F");
		expect<unknown>(scanOutgoing(both, ctx)).toEqual({
			outcome: "context",
			findings: [
				{ kind: "home-dir", span: { start: 3, end: 14 }, fix: "~" },
				{
					kind: "home-dir",
					span: { start: encodedStart, end: encodedStart + 15 },
				},
			],
		});
		// overlap resolution: the longer encoded work directory wins over the encoded home directory inside it
		expect<unknown>(
			scanOutgoing(
				"?p=%2Fhome%2Falice%2Fapp",
				context({ homeDirs: ["/home/alice"], workDirs: ["/home/alice/app"] }),
			),
		).toEqual({
			outcome: "context",
			findings: [{ kind: "work-dir", span: { start: 3, end: 24 } }],
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

describe("a secret hidden behind look-alike or invisible characters", () => {
	const ZWSP = String.fromCharCode(0x200b);
	/** Each printable ASCII character written as its fullwidth form (U+FF01 plus the offset from "!"). */
	function fullwidth(text: string): string {
		return [...text]
			.map((char) => String.fromCodePoint((char.codePointAt(0) ?? 0) + 0xfee0))
			.join("");
	}
	/** Every 8-character window of every variant of the secret must be absent from the result. */
	function expectNoEightCharacters(result: unknown, secret: string) {
		const json = JSON.stringify(result);
		for (const variant of [
			secret,
			secret.replaceAll(ZWSP, ""),
			secret.replaceAll(ZWSP, "").normalize("NFKC"),
		]) {
			for (let at = 0; at + 8 <= variant.length; at += 1) {
				expect(json).not.toContain(variant.slice(at, at + 8));
			}
		}
	}

	test("a fullwidth token is a secret", () => {
		const token = fakeSecret("github-token");
		const written = fullwidth(token);
		expect(written).not.toBe(token);
		const result = scanOutgoing(`I pasted ${written} here`, EMPTY);
		expect<unknown>(result).toEqual({
			outcome: "secret",
			rules: ["github-token"],
		});
		expectNoEightCharacters(result, written);
		expectNoEightCharacters(result, token);
	});

	test("a token with a zero-width space after its prefix is a secret", () => {
		const token = fakeSecret("github-token");
		const written = `${token.slice(0, 4)}${ZWSP}${token.slice(4)}`;
		expect(written).toContain(ZWSP);
		const result = scanOutgoing(`I pasted ${written} here`, EMPTY);
		expect<unknown>(result).toEqual({
			outcome: "secret",
			rules: ["github-token"],
		});
		expectNoEightCharacters(result, written);
	});

	test("a fullwidth token with a zero-width space is a secret", () => {
		const token = fakeSecret("github-token");
		const written = `${fullwidth(token.slice(0, 4))}${ZWSP}${fullwidth(token.slice(4))}`;
		expect<unknown>(scanOutgoing(`I pasted ${written} here`, EMPTY)).toEqual({
			outcome: "secret",
			rules: ["github-token"],
		});
	});

	test("an env value written fullwidth is an env-value secret", () => {
		const value = randomAlnum(20);
		const result = scanOutgoing(
			`it printed ${fullwidth(value)} to the log`,
			context({ env: [{ name: "DEPLOY_TOKEN", value }] }),
		);
		expect<unknown>(result).toEqual({
			outcome: "secret",
			rules: ["env-value"],
		});
		expectNoEightCharacters(result, fullwidth(value));
		expectNoEightCharacters(result, value);
	});

	test("an env value split by a zero-width space is an env-value secret", () => {
		const value = randomAlnum(20);
		const written = `${value.slice(0, 7)}${ZWSP}${value.slice(7)}`;
		expect<unknown>(
			scanOutgoing(
				`it printed ${written} to the log`,
				context({ env: [{ name: "DEPLOY_TOKEN", value }] }),
			),
		).toEqual({ outcome: "secret", rules: ["env-value"] });
	});

	test("the near-miss written fullwidth or with a zero-width space stays clean", () => {
		const nearMiss = `${"gh" + "p_"}${randomAlnum(10)}`;
		for (const written of [
			nearMiss,
			fullwidth(nearMiss),
			`${nearMiss.slice(0, 4)}${ZWSP}${nearMiss.slice(4)}`,
		]) {
			expect<unknown>(scanOutgoing(`I pasted ${written} here`, EMPTY)).toEqual({
				outcome: "clean",
			});
		}
	});

	test("input that does not conform is scanned, not refused", () => {
		const text = `bell\u0007 and ${ZWSP} and \r\n`;
		expect<unknown>(scanOutgoing(text, EMPTY)).toEqual({ outcome: "clean" });
	});

	test("context findings and spans stay on the raw text", () => {
		const text = `${ZWSP}see /home/u/x`;
		expect<unknown>(
			scanOutgoing(text, context({ homeDirs: ["/home/u"] })),
		).toEqual({
			outcome: "context",
			findings: [{ kind: "home-dir", span: { start: 5, end: 12 }, fix: "~" }],
		});
	});
});
