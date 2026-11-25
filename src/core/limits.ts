export const FORMAT_VERSION = 1;
export const WARNING_TAGS = [
	"network-or-install",
	"config-or-credential",
	"disables-check",
	"indirect-execution",
	"edits-executable",
] as const;
export type WarningTag = (typeof WARNING_TAGS)[number];
export const LIMITS = {
	summaryCodePoints: 120, // spec 7
	failureSignatureBytes: 200,
	whatWasDoneBytes: 800,
	whatHappenedBytes: 800,
	whatWasExpectedBytes: 400,
	workaroundBytes: 800,
	freeTextBytes: 2000,
	noteTextBytes: 4096, // all text fields of one note together
	versionChars: 64, // spec 12.1
	rawAddressBytes: 1024,
	addressBytes: 256,
	versionRows: 16,
	entriesPerDigestPage: 50,
	summariesPerGroup: 10, // spec 7
	repliesPerGroup: 10,
	unknownFormatListed: 10,
	queryWords: 8,
	notReproducedThreshold: 3, // spec 12.4
	scanEnvSecretNamedMinChars: 8, // [PROPOSED, UNMEASURED] shortest value of a secret-named variable the scanner looks for
	scanEnvEntropyMinChars: 20, // [PROPOSED, UNMEASURED] shortest value the scanner judges by entropy alone
	scanEntropyBitsPerChar: 3.5, // [PROPOSED, UNMEASURED] Shannon entropy per character at or above which a value counts as random
	scanContextNameMinChars: 3, // [PROPOSED, UNMEASURED] shortest user, host, branch or package name the scanner looks for
	envelopeBytes: 16384, // [PROPOSED, UNMEASURED] hard cap (7.3) on the text inside one untrusted block
	summaryLineBytes: 1024, // [PROPOSED, UNMEASURED] strict cap (12.3) on one rendered summary line; covers the worst validated prefix plus a 120-code-point summary of 4-byte characters
} as const;
