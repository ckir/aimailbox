import { canonicalise } from "./address.ts";
import type { Result } from "./result.ts";

export type PolicyMode = "deny" | "confirm-each" | "allow";
export type PolicyRule = { directory: string } | { remote: string };
export type PolicyEntry = PolicyRule & {
	mode: PolicyMode;
	unattendedPostRead?: boolean;
};
export type Policy = {
	formatVersion: 1;
	defaultMode: PolicyMode;
	unattendedPostRead: boolean;
	rules: PolicyEntry[]; // a remote is stored as canonical "host/path"
};
export type PolicyError = "not-an-object" | "unknown-format" | "bad-field";

export const DEFAULT_POLICY: Policy = {
	formatVersion: 1,
	defaultMode: "deny",
	unattendedPostRead: false,
	rules: [],
};

const TOOL_PREFIX = "tool/";
const MODES: readonly PolicyMode[] = ["deny", "confirm-each", "allow"];
const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
	"formatVersion",
	"defaultMode",
	"unattendedPostRead",
	"rules",
]);
const ENTRY_KEYS: ReadonlySet<string> = new Set([
	"directory",
	"remote",
	"mode",
	"unattendedPostRead",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A property whose value is undefined is treated as absent.
function presentKeys(record: Record<string, unknown>): string[] {
	return Object.keys(record).filter((key) => record[key] !== undefined);
}

function isMode(value: unknown): value is PolicyMode {
	return MODES.some((mode) => mode === value);
}

// Absolute, no "." or ".." segment, no NUL, no empty segment. One trailing "/" is
// dropped; the root stays "/". Returns undefined for anything else.
function readDirectory(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.startsWith("/")) return undefined;
	if (value.includes("\0")) return undefined;
	let body = value.slice(1);
	if (body === "") return "/";
	if (body.endsWith("/")) body = body.slice(0, -1);
	for (const segment of body.split("/")) {
		if (segment === "" || segment === "." || segment === "..") return undefined;
	}
	return `/${body}`;
}

// The stored form of a remote is the canonical "host/path", without the "tool/" prefix.
function canonicalRemote(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const canonical = canonicalise(TOOL_PREFIX + value);
	if (!canonical.ok || !canonical.value.startsWith(TOOL_PREFIX))
		return undefined;
	return canonical.value.slice(TOOL_PREFIX.length);
}

function readEntry(value: unknown): PolicyEntry | undefined {
	if (!isRecord(value)) return undefined;
	const keys = presentKeys(value);
	if (keys.some((key) => !ENTRY_KEYS.has(key))) return undefined;
	const { directory, remote, mode, unattendedPostRead } = value;
	if (!isMode(mode)) return undefined;
	if (
		unattendedPostRead !== undefined &&
		typeof unattendedPostRead !== "boolean"
	) {
		return undefined;
	}
	if ((directory === undefined) === (remote === undefined)) return undefined;
	let entry: PolicyEntry;
	if (directory !== undefined) {
		const dir = readDirectory(directory);
		if (dir === undefined) return undefined;
		entry = { directory: dir, mode };
	} else {
		const rem = canonicalRemote(remote);
		if (rem === undefined) return undefined;
		entry = { remote: rem, mode };
	}
	if (unattendedPostRead !== undefined)
		entry.unattendedPostRead = unattendedPostRead;
	return entry;
}

export function readPolicy(value: unknown): Result<Policy, PolicyError> {
	if (!isRecord(value)) return { ok: false, error: "not-an-object" };
	if (value.formatVersion !== 1) return { ok: false, error: "unknown-format" };
	if (presentKeys(value).some((key) => !TOP_LEVEL_KEYS.has(key))) {
		return { ok: false, error: "bad-field" };
	}
	const { defaultMode, unattendedPostRead, rules } = value;
	if (!isMode(defaultMode)) return { ok: false, error: "bad-field" };
	if (typeof unattendedPostRead !== "boolean")
		return { ok: false, error: "bad-field" };
	if (!Array.isArray(rules)) return { ok: false, error: "bad-field" };
	const entries: PolicyEntry[] = [];
	for (const raw of rules as unknown[]) {
		const entry = readEntry(raw);
		if (entry === undefined) return { ok: false, error: "bad-field" };
		entries.push(entry);
	}
	return {
		ok: true,
		value: {
			formatVersion: 1,
			defaultMode,
			unattendedPostRead,
			rules: entries,
		},
	};
}

export type Call = {
	directory: string;
	remotes: readonly string[];
	vetoed: boolean;
};
export type Resolution = {
	mode: PolicyMode;
	vetoed: boolean;
	unattendedPostRead: boolean;
};

// Higher is more restrictive: deny over confirm-each over allow.
const RESTRICTION: Record<PolicyMode, number> = {
	allow: 0,
	"confirm-each": 1,
	deny: 2,
};

function directoryMatches(rule: string, directory: string): boolean {
	if (rule === "/") return true;
	return directory === rule || directory.startsWith(`${rule}/`);
}

function callRemotes(remotes: readonly string[]): Set<string> {
	const found = new Set<string>();
	for (const remote of remotes) {
		const canonical = canonicalRemote(remote);
		if (canonical !== undefined) found.add(canonical);
	}
	return found;
}

export function resolvePolicy(policy: Policy, call: Call): Resolution {
	if (call.vetoed)
		return { mode: "deny", vetoed: true, unattendedPostRead: false };
	const remotes = callRemotes(call.remotes);
	let mode: PolicyMode | undefined;
	let unattendedPostRead = policy.unattendedPostRead;
	for (const entry of policy.rules) {
		const matches =
			"directory" in entry
				? directoryMatches(entry.directory, call.directory)
				: remotes.has(entry.remote);
		if (!matches) continue;
		if (mode === undefined || RESTRICTION[entry.mode] > RESTRICTION[mode]) {
			mode = entry.mode;
		}
		if (entry.unattendedPostRead === false) unattendedPostRead = false;
	}
	return {
		mode: mode ?? policy.defaultMode,
		vetoed: false,
		unattendedPostRead,
	};
}

export type Permission = "yes" | "needs-human" | "no";

// "yes" is the policy's answer only: the post-read rules (8.3) and the human's
// confirmation (8.5) apply on top. A retraction under confirm-each asks, because 8.4
// has the human confirm every outgoing item.
export function policyPermission(
	resolution: Resolution,
	operation: "retraction" | "other",
): Permission {
	if (operation === "retraction") {
		return !resolution.vetoed && resolution.mode === "confirm-each"
			? "needs-human"
			: "yes";
	}
	if (resolution.vetoed || resolution.mode === "deny") return "no";
	return resolution.mode === "confirm-each" ? "needs-human" : "yes";
}
