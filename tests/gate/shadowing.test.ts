/**
 * Guards against files that defeat a gate without touching the guarded file:
 * a second lefthook configuration that overrides `lefthook.yml`, and a second
 * workflow that escapes the checks made on `ci.yml`.
 */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

test("lefthook.yml is the only tracked lefthook configuration", async () => {
	// lefthook merges `lefthook-local.yml` over `lefthook.yml`. Committed, a
	// line such as `commit-msg: { skip: true }` there switches a hook off for
	// everyone. A personal, untracked one is the developer's own business.
	const listing = Bun.spawn(["git", "ls-files"], {
		cwd: repoRoot,
		stdout: "pipe",
	});
	const tracked = (await new Response(listing.stdout).text()).split("\n");
	expect(await listing.exited).toBe(0);
	const configs = tracked.filter((file) =>
		/(^|\/)\.?lefthook(-local)?\.(ya?ml|toml|json|jsonc)$/.test(file),
	);
	expect(configs).toEqual(["lefthook.yml"]);
});

interface AnyWorkflow {
	permissions?: unknown;
	defaults?: unknown;
	jobs?: Record<
		string,
		{
			permissions?: unknown;
			defaults?: unknown;
			container?: unknown;
			services?: unknown;
			uses?: string;
			steps?: { uses?: string }[];
		}
	>;
}

test("every workflow is read-only, pins its actions to full commit SHAs and keeps the default shell", async () => {
	// The tests in ci.test.ts read ci.yml only. A second workflow would
	// otherwise be free to use a movable tag or ask for write access.
	const directory = join(repoRoot, ".github/workflows");
	const files = readdirSync(directory).filter((name) => /\.ya?ml$/.test(name));
	expect(files).toContain("ci.yml");
	for (const file of files) {
		const workflow = Bun.YAML.parse(
			await Bun.file(join(directory, file)).text(),
		) as AnyWorkflow;
		expect({ file, permissions: workflow.permissions }).toEqual({
			file,
			permissions: { contents: "read" },
		});
		expect({ file, defaults: workflow.defaults }).toEqual({
			file,
			defaults: undefined,
		});
		for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
			expect({ file, name, permissions: job.permissions }).toEqual({
				file,
				name,
				permissions: undefined,
			});
			// `defaults.run.shell` can drop the shell's stop-on-error flags for
			// every step; `container` and `services` pull images by movable tag.
			expect({
				file,
				name,
				defaults: job.defaults,
				container: job.container,
				services: job.services,
			}).toEqual({
				file,
				name,
				defaults: undefined,
				container: undefined,
				services: undefined,
			});
			const used = [job.uses, ...(job.steps ?? []).map((step) => step.uses)];
			for (const uses of used) {
				if (uses === undefined) continue;
				expect({ file, name, uses }).toEqual({
					file,
					name,
					uses: expect.stringMatching(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/),
				});
			}
		}
	}
});
