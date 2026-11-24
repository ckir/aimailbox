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
		return npmPart(scope.slice(1)) && npmPart(bare) ? name : undefined;
	}
	if (parts.length !== 1 || name.startsWith("-") || name.startsWith("_"))
		return undefined;
	return npmPart(name) ? name : undefined;
}

function npmPart(part: string): boolean {
	return NPM_PART.test(part) && !part.startsWith(".");
}

function pypiName(name: string): string | undefined {
	if (!PYPI_NAME.test(name)) return undefined;
	return asciiLower(name).replace(/[-_.]+/g, "-");
}

function cargoName(name: string): string | undefined {
	if (!CARGO_NAME.test(name)) return undefined;
	return asciiLower(name).replace(/_/g, "-");
}

// Task 5 fills in the go and tool rules.
function goName(_name: string): string | undefined {
	return undefined;
}

function toolName(_name: string): string | undefined {
	return undefined;
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
