import { ECOSYSTEMS, type Ecosystem } from "./ecosystem.ts";
import { LIMITS } from "./limits.ts";
import type { Result } from "./result.ts";
import { utf8Length } from "./text.ts";

export type AddressError = "too-long" | "unknown-prefix" | "bad-name";

// Rules of the npm registry, not sizes of this system.
const NPM_NAME_CHARS = 214;
const NPM_RESERVED = ["node_modules", "favicon.ico"];

const NPM_PART = /^[A-Za-z0-9._~-]+$/;
const PYPI_NAME = /^([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9])$/;
// The cargo limit of 64 characters is the {0,63} after the first letter.
const CARGO_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

// Lowercases ASCII A-Z only; toLowerCase would also fold other scripts.
function asciiLower(text: string): string {
	return text.replace(/[A-Z]/g, (c) =>
		String.fromCharCode(c.charCodeAt(0) + 32),
	);
}

function isEcosystem(word: string): word is Ecosystem {
	return (ECOSYSTEMS as readonly string[]).includes(word);
}

function npmName(name: string): string | undefined {
	if (name.length > NPM_NAME_CHARS) return undefined;
	if (NPM_RESERVED.includes(asciiLower(name))) return undefined;
	const parts = name.split("/");
	if (name.startsWith("@")) {
		if (parts.length !== 2) return undefined;
		const [scope, bare] = parts as [string, string];
		// Only the package part may not start with a dot; the scope may.
		return npmPart(scope.slice(1)) && npmPart(bare) && !bare.startsWith(".")
			? name
			: undefined;
	}
	if (parts.length !== 1 || name.startsWith("-") || name.startsWith("_"))
		return undefined;
	return npmPart(name) && !name.startsWith(".") ? name : undefined;
}

function npmPart(part: string): boolean {
	return NPM_PART.test(part);
}

function pypiName(name: string): string | undefined {
	if (!PYPI_NAME.test(name)) return undefined;
	return asciiLower(name).replace(/[-_.]+/g, "-");
}

function cargoName(name: string): string | undefined {
	if (!CARGO_NAME.test(name)) return undefined;
	return asciiLower(name).replace(/_/g, "-");
}

// Go module paths: the host is lowercased, the rest keeps its case, and a
// major version is dropped so every major version shares one box.
// Windows device names that Go refuses as the part of an element before its
// first dot, compared in lower case.
const GO_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const GO_ELEMENT = /^[A-Za-z0-9._~-]+$/;
const GO_HOST = /^[a-z0-9.-]+$/;
const GO_VERSION_SUFFIX = /\.v[0-9]+(\..*)?$/;
const GO_ALLOWED_SUFFIX = /^\.v(0|[1-9][0-9]*)$/;
const GO_UNSTABLE = "-unstable";
const GO_MAJOR_ELEMENT = /^v[1-9][0-9]*$/;
// A final element is a version, in the sense of SplitPathVersion, when it is
// "v" followed only by digits and dots. Of those, /vN for N >= 2 is the one
// major version element; v0, v1, v0N and any with a dot (v1.2, v.2, v2.) are
// refused. An element such as v1.x or v8.dev is an ordinary element.
const GO_REFUSED_FINAL = /^(v0|v1|v0[0-9]+|v[0-9.]*\.[0-9.]*)$/;

function goElement(element: string): boolean {
	if (!GO_ELEMENT.test(element)) return false;
	if (element.startsWith(".") || element.endsWith(".")) return false;
	const dot = element.indexOf(".");
	const short = dot < 0 ? element : element.slice(0, dot);
	return !GO_RESERVED.test(asciiLower(short)) && !/~[0-9]+$/.test(short);
}

// The last element of a gopkg.in path: the element with its version suffix
// removed, or the element unchanged when it has none; undefined when refused.
// "-unstable" after the version goes with it, as in SplitPathVersion. This is a
// leftmost match: Go accepts a name with an internal ".vN.word" segment such as
// "pkg.v2.foo.v3" and we refuse it. That over-refusal is known and parked.
function gopkgLast(last: string): string | undefined {
	const unstable = last.endsWith(GO_UNSTABLE);
	const core = unstable ? last.slice(0, -GO_UNSTABLE.length) : last;
	const found = GO_VERSION_SUFFIX.exec(core);
	if (found === null) {
		// Go's splitGopkgIn accepts ".v-unstable", but the result fails
		// module.Check and panics PathMajorPrefix, so no real package has such a
		// name. Refused, with or without "-unstable".
		return core.endsWith(".v") ? undefined : last;
	}
	// SplitPathVersion refuses ".v0-unstable" too (a leading zero).
	if (!GO_ALLOWED_SUFFIX.test(found[0]) || (unstable && found[0] === ".v0"))
		return undefined;
	const bare = core.slice(0, found.index);
	return goElement(bare) ? bare : undefined;
}

function goName(name: string): string | undefined {
	const elements = name.split("/");
	if (!elements.every(goElement)) return undefined;
	const host = asciiLower(elements[0] as string);
	if (!GO_HOST.test(host) || !host.includes(".") || host.startsWith("-"))
		return undefined;
	elements[0] = host;
	if (host === "gopkg.in") {
		if (elements.length < 2 || elements.length > 3) return undefined;
		const last = elements[elements.length - 1] as string;
		const bare = gopkgLast(last);
		// The result must be unchanged by the same rule, so the canonical form is
		// a fixed point by construction.
		if (bare === undefined || gopkgLast(bare) !== bare) return undefined;
		elements[elements.length - 1] = bare;
	} else if (elements.length >= 2) {
		const last = elements[elements.length - 1] as string;
		if (GO_REFUSED_FINAL.test(last)) return undefined;
		if (GO_MAJOR_ELEMENT.test(last)) {
			elements.pop();
			const next = elements[elements.length - 1] as string;
			// What is left must not itself be a version element, or it would
			// canonicalise again to something else.
			if (
				elements.length >= 2 &&
				(GO_MAJOR_ELEMENT.test(next) || GO_REFUSED_FINAL.test(next))
			)
				return undefined;
		}
	}
	return elements.join("/");
}

const TOOL_SCHEME = /^([A-Za-z]+):\/\//;
const TOOL_SCHEMES = ["https", "http", "ssh", "git"];
const TOOL_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const TOOL_ELEMENT = /^[a-z0-9._~-]+$/;

// Splits a tool name into host and path in one of its three forms (URL,
// remote, plain), tried in that order. Nothing is lowercased or trimmed yet.
function toolParts(name: string): { host: string; path: string } | undefined {
	const scheme = TOOL_SCHEME.exec(name);
	if (scheme !== null) {
		if (!TOOL_SCHEMES.includes(asciiLower(scheme[1] as string)))
			return undefined;
		let rest = name.slice(scheme[0].length);
		const hash = rest.indexOf("#");
		if (hash >= 0) rest = rest.slice(0, hash);
		const query = rest.indexOf("?");
		if (query >= 0) rest = rest.slice(0, query);
		const slash = rest.indexOf("/");
		if (slash < 0) return undefined;
		let authority = rest.slice(0, slash);
		const path = rest.slice(slash + 1);
		const at = authority.indexOf("@");
		if (at >= 0) {
			if (at === 0 || authority.indexOf("@", at + 1) >= 0) return undefined;
			authority = authority.slice(at + 1);
		}
		return { host: authority.replace(/:[0-9]+$/, ""), path };
	}
	const at = name.indexOf("@");
	if (at >= 0) {
		const user = name.slice(0, at);
		const rest = name.slice(at + 1);
		if (user === "" || /[/:?#@\s]/.test(user)) return undefined;
		const colon = rest.indexOf(":");
		if (colon < 0) return undefined;
		const path = rest.slice(colon + 1);
		if (/[?#]/.test(path)) return undefined;
		return { host: rest.slice(0, colon), path };
	}
	const slash = name.indexOf("/");
	if (slash < 0) return undefined;
	return { host: name.slice(0, slash), path: name.slice(slash + 1) };
}

// Only printable ASCII without space is allowed anywhere in a tool name, so the
// parts canonicalisation discards (credentials, query, fragment, remote user)
// are checked too: anything else is rejected, never repaired.
const TOOL_NAME_CHARS = /^[!-~]*$/;

function toolName(name: string): string | undefined {
	if (!TOOL_NAME_CHARS.test(name)) return undefined;
	const parts = toolParts(name);
	if (parts === undefined) return undefined;
	const host = asciiLower(parts.host);
	let path = asciiLower(parts.path).replace(/\/+$/, "");
	if (path.endsWith(".git")) path = path.slice(0, -4);
	if (path === "" || path.endsWith(".git") || path.endsWith("/"))
		return undefined;
	const labels = host.split(".");
	if (labels.length < 2 || !labels.every((l) => TOOL_LABEL.test(l)))
		return undefined;
	const elements = path.split("/");
	if (!elements.every((e) => TOOL_ELEMENT.test(e) && e !== "." && e !== ".."))
		return undefined;
	return `${host}/${path}`;
}

const NAME_RULES: Record<Ecosystem, (name: string) => string | undefined> = {
	npm: npmName,
	cargo: cargoName,
	go: goName,
	pypi: pypiName,
	tool: toolName,
};

export function canonicalise(input: string): Result<string, AddressError> {
	if (utf8Length(input) > LIMITS.rawAddressBytes)
		return { ok: false, error: "too-long" };
	const slash = input.indexOf("/");
	const prefix = slash < 0 ? "" : input.slice(0, slash);
	if (!isEcosystem(prefix)) return { ok: false, error: "unknown-prefix" };
	const name = NAME_RULES[prefix](input.slice(slash + 1));
	if (name === undefined) return { ok: false, error: "bad-name" };
	const address = `${prefix}/${name}`;
	if (utf8Length(address) > LIMITS.addressBytes)
		return { ok: false, error: "too-long" };
	return { ok: true, value: address };
}

export function isCanonical(address: string): boolean {
	const result = canonicalise(address);
	return result.ok && result.value === address;
}

export function ecosystemOf(canonicalAddress: string): Ecosystem {
	if (!isCanonical(canonicalAddress))
		throw new Error("not a canonical address");
	return canonicalAddress.slice(0, canonicalAddress.indexOf("/")) as Ecosystem;
}

export function formatNoteId(
	canonicalAddress: string,
	noteNumber: number,
): string {
	if (!isCanonical(canonicalAddress))
		throw new Error("not a canonical address");
	if (!Number.isSafeInteger(noteNumber) || noteNumber < 1)
		throw new Error("note number must be a positive safe integer");
	return `${canonicalAddress}#${noteNumber}`;
}

export function parseNoteId(
	id: string,
): Result<{ address: string; noteNumber: number }, "bad-note-id"> {
	const hash = id.indexOf("#");
	const failure = { ok: false, error: "bad-note-id" } as const;
	if (hash < 0) return failure;
	const address = id.slice(0, hash);
	const digits = id.slice(hash + 1);
	if (!isCanonical(address) || !/^[1-9][0-9]*$/.test(digits)) return failure;
	const noteNumber = Number(digits);
	if (!Number.isSafeInteger(noteNumber)) return failure;
	return { ok: true, value: { address, noteNumber } };
}
