import { canonicalise, ecosystemOf } from "./address.ts";
import { LIMITS } from "./limits.ts";
import type { Result } from "./result.ts";
import { utf8Length } from "./text.ts";
import { resolveInstalled } from "./version.ts";

export type WorkspaceFile = {
	name: "package-lock.json" | "Cargo.lock" | "go.mod";
	text: string;
};

// Lock files are workspace content, so untrusted: every grammar below only
// reads the text it is given, gives [] for anything it does not understand, and
// never executes or evaluates any of it.

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownString(record: Record<string, unknown>, key: string) {
	if (!Object.hasOwn(record, key)) return undefined;
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function lines(text: string): string[] {
	return text.split(/\r?\n/);
}

// "node_modules/<name>" or ".../node_modules/<name>": the name is everything
// after the last node_modules path element, scope included.
function npmNameOfKey(key: string): string | undefined {
	const elements = key.split("/");
	const at = elements.lastIndexOf("node_modules");
	if (at < 0 || at === elements.length - 1) return undefined;
	return elements.slice(at + 1).join("/");
}

function npmVersions(address: string, text: string): string[] {
	let root: unknown;
	try {
		root = JSON.parse(text);
	} catch {
		return [];
	}
	if (!isRecord(root)) return [];
	const lockfileVersion = Object.hasOwn(root, "lockfileVersion")
		? root.lockfileVersion
		: undefined;
	if (lockfileVersion !== 2 && lockfileVersion !== 3) return [];
	const packages = Object.hasOwn(root, "packages") ? root.packages : undefined;
	if (!isRecord(packages)) return [];
	const found: string[] = [];
	for (const [key, value] of Object.entries(packages)) {
		const name = npmNameOfKey(key);
		if (name === undefined || `npm/${name}` !== address) continue;
		if (!isRecord(value)) continue;
		if (Object.hasOwn(value, "link") && value.link === true) continue;
		const version = ownString(value, "version");
		if (version !== undefined) found.push(version);
	}
	return found;
}

const CARGO_STRING = /^(name|version) = "([^"\\]*)"$/;
const TOML_MULTILINE = ["'''", '"""'] as const;

// The delimiter of a multi-line TOML string that a "key = value" line opens
// and does not close, if any.
function opensMultiline(line: string): string | undefined {
	const equals = line.indexOf("=");
	if (equals < 0) return undefined;
	const value = line.slice(equals + 1).trimStart();
	for (const delimiter of TOML_MULTILINE) {
		if (value.startsWith(delimiter) && !value.includes(delimiter, 3)) {
			return delimiter;
		}
	}
	return undefined;
}

function cargoVersions(address: string, text: string): string[] {
	const found: string[] = [];
	let inBlock = false;
	let name: string | undefined;
	let version: string | undefined;
	let multiline: string | undefined;
	const finish = () => {
		if (inBlock && name !== undefined && version !== undefined) {
			const canonical = canonicalise(`cargo/${name}`);
			if (canonical.ok && canonical.value === address) found.push(version);
		}
		inBlock = false;
		name = undefined;
		version = undefined;
	};
	for (const line of lines(text)) {
		if (multiline !== undefined) {
			if (line.includes(multiline)) multiline = undefined;
			continue;
		}
		if (line.startsWith("[")) {
			finish();
			inBlock = line === "[[package]]";
			continue;
		}
		if (!inBlock) continue;
		const match = CARGO_STRING.exec(line);
		if (match !== null) {
			if (match[1] === "name") name ??= match[2];
			else version ??= match[2];
			continue;
		}
		multiline = opensMultiline(line);
	}
	finish();
	return found;
}

const GO_BLOCK_OPEN = /^([A-Za-z]+)\s*\(\s*$/;
const GO_REQUIRE_LINE = /^require\s+(\S+)\s+(\S+)$/;
const GO_BLOCK_LINE = /^(\S+)\s+(\S+)$/;

function goComment(line: string): string {
	const comment = line.indexOf("//");
	return (comment < 0 ? line : line.slice(0, comment)).trim();
}

// A block or directive that is not closed means a file the go tool itself
// would refuse: it is not understood, so it gives no versions.
function goVersions(address: string, text: string): string[] {
	const found: string[] = [];
	const add = (path: string | undefined, version: string | undefined) => {
		if (path === undefined || version === undefined) return;
		const canonical = canonicalise(`go/${path}`);
		if (canonical.ok && canonical.value === address) found.push(version);
	};
	let block: string | undefined;
	for (const raw of lines(text)) {
		const line = goComment(raw);
		if (block !== undefined) {
			if (line === ")") {
				block = undefined;
			} else if (block === "require") {
				const match = GO_BLOCK_LINE.exec(line);
				add(match?.[1], match?.[2]);
			}
			continue;
		}
		const open = GO_BLOCK_OPEN.exec(line);
		if (open !== null) {
			block = open[1];
			continue;
		}
		const single = GO_REQUIRE_LINE.exec(line);
		if (single !== null) add(single[1], single[2]);
	}
	return block === undefined ? found : [];
}

/** Every exact version the given files record for this box, in file order; [] when none or when a file is not understood. */
export function recordedVersions(
	address: string,
	files: readonly WorkspaceFile[],
): string[] {
	const ecosystem = ecosystemOf(address);
	const found: string[] = [];
	// push in a loop: spreading a very large array into one call can overflow the stack
	const take = (versions: string[]) => {
		for (const version of versions) found.push(version);
	};
	for (const file of files) {
		if (typeof file.text !== "string") continue;
		if (utf8Length(file.text) > LIMITS.lockFileBytes) continue;
		if (ecosystem === "npm" && file.name === "package-lock.json") {
			take(npmVersions(address, file.text));
		} else if (ecosystem === "cargo" && file.name === "Cargo.lock") {
			take(cargoVersions(address, file.text));
		} else if (ecosystem === "go" && file.name === "go.mod") {
			take(goVersions(address, file.text));
		}
	}
	return found;
}

// A range operator that the version charset of 12.1 allows ("^" and "~"; the
// other operators are outside the charset). resolveInstalled would accept
// "~1.2" as a version, but a range is never an installed version (12.4 rule 4).
function isRange(version: string): boolean {
	return version.startsWith("^") || version.startsWith("~");
}

/** 12.4 rule 4: the explicit version, else the single recorded one, else undefined. */
export function detectInstalled(
	address: string,
	explicit: string | undefined,
	files: readonly WorkspaceFile[],
): Result<string | undefined, "invalid-version"> {
	const ecosystem = ecosystemOf(address);
	const recorded = recordedVersions(address, files);
	if (explicit === undefined && recorded.some(isRange)) {
		return { ok: true, value: undefined };
	}
	return resolveInstalled(ecosystem, explicit, recorded);
}
