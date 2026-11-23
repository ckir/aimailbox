/**
 * Pins the lines of the CI workflow that make it the authoritative gate. The
 * workflow cannot be run locally, so these read the file: they catch an edit
 * that quietly weakens it, not a fault in GitHub Actions itself.
 *
 * This file lives outside tests/toolchain/ on purpose. It is fast, so it runs
 * in `just test` and therefore in `check-fast`: a pull request that downgrades
 * the workflow to the fast gate still runs it, and fails.
 */
import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

interface Step {
	name?: string;
	uses?: string;
	run?: string;
	with?: Record<string, unknown>;
}

interface Workflow {
	on: {
		push: { branches: string[] };
		pull_request: { types: string[] };
	};
	permissions: Record<string, string>;
	env: Record<string, unknown>;
	jobs: Record<string, { steps: Step[] }>;
}

async function loadWorkflow(): Promise<Workflow> {
	const text = await Bun.file(
		join(repoRoot, ".github/workflows/ci.yml"),
	).text();
	return Bun.YAML.parse(text) as Workflow;
}

async function steps(): Promise<Step[]> {
	const workflow = await loadWorkflow();
	const job = workflow.jobs.check;
	if (job === undefined) throw new Error("ci.yml has no `check` job");
	return job.steps;
}

/** The GitHub Actions expression that reads a workflow-level `env` value. */
function envExpression(name: string): string {
	return `\${{ env.${name} }}`;
}

function stepUsing(all: Step[], action: string): Step {
	const found = all.find((step) => step.uses?.startsWith(`${action}@`));
	if (found === undefined) throw new Error(`ci.yml has no ${action} step`);
	return found;
}

test("CI runs on pushes to main and on pull requests, including a changed base", async () => {
	const workflow = await loadWorkflow();
	expect(workflow.on.push.branches).toContain("main");
	expect(workflow.on.pull_request.types).toEqual(
		expect.arrayContaining(["opened", "synchronize", "reopened", "edited"]),
	);
});

test("CI has read-only access to the repository", async () => {
	const workflow = await loadWorkflow();
	expect(workflow.permissions).toEqual({ contents: "read" });
});

test("CI checks out the full history, which the secret scan needs", async () => {
	const checkout = stepUsing(await steps(), "actions/checkout");
	expect(checkout.with?.["fetch-depth"]).toBe(0);
});

test("CI runs the full gate, not the fast one", async () => {
	const runs = (await steps()).map((step) => step.run?.trim());
	expect(runs).toContain("just check");
	expect(runs).not.toContain("just check-fast");
});

test("CI installs dependencies from the lockfile", async () => {
	const runs = (await steps()).map((step) => step.run?.trim());
	expect(runs).toContain("bun install --frozen-lockfile");
});

test("CI pins the version of every tool it installs", async () => {
	const workflow = await loadWorkflow();
	for (const name of ["BUN_VERSION", "JUST_VERSION", "GITLEAKS_VERSION"]) {
		expect({ name, value: String(workflow.env[name]) }).toEqual({
			name,
			value: expect.stringMatching(/^\d+\.\d+\.\d+$/),
		});
	}
	const all = await steps();
	expect(stepUsing(all, "oven-sh/setup-bun").with?.["bun-version"]).toBe(
		envExpression("BUN_VERSION"),
	);
	expect(stepUsing(all, "extractions/setup-just").with?.["just-version"]).toBe(
		envExpression("JUST_VERSION"),
	);
});

test("CI pins every action to a full commit SHA", async () => {
	// A version tag can be moved to different code; a commit SHA cannot.
	const used = (await steps())
		.map((step) => step.uses)
		.filter((uses) => uses !== undefined);
	expect(used.length).toBeGreaterThan(0);
	for (const uses of used) {
		expect(uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
	}
});

test("CI downloads each binary at its pinned version and verifies its checksum", async () => {
	const all = await steps();
	for (const [name, variable] of [
		["Install gitleaks", "GITLEAKS_VERSION"],
	] as const) {
		const step = all.find((candidate) => candidate.name === name);
		const script = step?.run ?? "";
		// The shell form of the pinned version, as the download URL uses it.
		const reference = `\${${variable}}`;
		expect({ name, usesPin: script.includes(reference) }).toEqual({
			name,
			usesPin: true,
		});
		expect({ name, script }).toEqual({
			name,
			script: expect.stringContaining("sha256sum -c"),
		});
		expect({ name, script }).toEqual({
			name,
			script: expect.not.stringContaining("latest"),
		});
	}
});

test("nothing in the CI job lets a failing step pass or be skipped", async () => {
	const workflow = (await loadWorkflow()) as unknown as {
		jobs: Record<string, Record<string, unknown>>;
	};
	const job = workflow.jobs.check ?? {};
	expect(job["continue-on-error"]).toBeUndefined();
	expect(job.if).toBeUndefined();
	for (const step of (await steps()) as Record<string, unknown>[]) {
		const label = step.name ?? step.uses;
		expect({ label, value: step["continue-on-error"] }).toEqual({
			label,
			value: undefined,
		});
		expect({ label, value: step.if }).toEqual({ label, value: undefined });
		expect({ label, value: step.shell }).toEqual({ label, value: undefined });
	}
});

test("the CI job does not widen the workflow's read-only access", async () => {
	const workflow = (await loadWorkflow()) as unknown as {
		jobs: Record<string, { permissions?: unknown }>;
	};
	for (const [name, job] of Object.entries(workflow.jobs)) {
		expect({ name, permissions: job.permissions }).toEqual({
			name,
			permissions: undefined,
		});
	}
});

test("no CI script swallows a failing command", async () => {
	// `|| true` after the checksum check, or `set +e`, `set +o errexit` and the
	// like, would let a tampered download through. No script here needs `||`
	// or `set +...` at all; a future one that does should change this test.
	for (const step of await steps()) {
		const script = step.run ?? "";
		const label = step.name ?? step.uses;
		expect({ label, script }).toEqual({
			label,
			script: expect.not.stringContaining("||"),
		});
		expect({ label, script }).toEqual({
			label,
			script: expect.not.stringMatching(/\bset\s+\+|;\s*true\b/),
		});
	}
	const install = (await steps()).find(
		(step) => step.name === "Install gitleaks",
	);
	const checks = (install?.run ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.includes("sha256sum -c"));
	expect(checks.length).toBe(1);
	expect(checks[0]).toMatch(/\| sha256sum -c -$/);
	expect(checks[0]).not.toMatch(/^#/);
});
