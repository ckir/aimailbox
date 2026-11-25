import { foldText } from "./fold.ts";
import { WARNING_TAGS, type WarningTag } from "./limits.ts";

// Warning tags (spec 7.4): coarse, best-effort rules over the folded text
// (lower-case, NFKC), so no `i` flag. The folded copy is never stored or shown.
// A tag only warns: no value of computeTags means "safe". The recipient
// recomputes tags, so a change to this table needs no format change.
const PATTERNS: Record<WarningTag, readonly RegExp[]> = {
	"network-or-install": [
		/\b(?:curl|wget|ncat|netcat|telnet|scp|sftp|rsync)\s/,
		/\bssh\s+\S/,
		/\b(?:npm|pnpm|yarn|bun|pip3?|pipx|uv|cargo|gem|brew|apt|apt-get|dnf|yum|apk|choco|winget|go)\s+(?:-\S+\s+)*(?:install|add|i|get)\b/,
		/\buv\s+(?:pip|tool)\s+install\b/,
		/\b(?:npx|bunx|pnpx|uvx)\s/,
		/\bpipx\s+run\b/,
		/\b(?:docker|podman)\s+(?:pull|run)\b/,
		/\bgit\s+(?:clone|fetch|pull)\b/,
		/\b[a-z][a-z0-9+.-]*:\/\/[^\s/]/,
	],
	"config-or-credential": [
		/\b(?:export|setenv|setx)\s+[a-z_][a-z0-9_]*(?:=|\s)/,
		/\$env:[a-z_]/,
		/(?:^|[\s"'=/])\.(?:env|npmrc|netrc|pypirc|bashrc|zshrc|profile|gitconfig)\b/,
		/(?:^|[\s"'=])(?:~|\$home)?\/?\.(?:aws|ssh|gnupg|config)\//,
		/\bgit\s+config\b/,
		/\b(?:npm|yarn|pnpm)\s+config\s+set\b/,
		/\b(?:api[_ -]?key|access[_ -]?key|secret[_ -]?key|auth[_ -]?token|password|passwd|credentials?|private[_ -]?key)\b/,
	],
	"disables-check": [
		/--no-(?:verify|check|checks|gpg-sign|sandbox|audit|lint|test|tests|hooks|strict|verification)\b/,
		/--(?:insecure|unsafe|force|dangerously-[a-z-]+|skip-[a-z-]+)\b/,
		/\b(?:disable|disabling|disabled|turn(?:ing)? off|skip|skipping|bypass|bypassing|ignore|ignoring)\s+(?:the\s+|all\s+|any\s+)?(?:checks?|lint(?:ing|er)?|tests?|hooks?|verification|signatures?|security|ssl|tls|certificates?|sandbox|safety|audit|typecheck|type[ -]check)\b/,
		/\b(?:strict-ssl|sslverify|verify|check_hostname|rejectunauthorized)\s*[=:]\s*(?:false|0|no|off)\b/,
		/\bnode_tls_reject_unauthorized\s*=\s*0\b/,
		/\b(?:nolint|noqa)\b|@ts-(?:ignore|nocheck|expect-error)|eslint-disable|biome-ignore/,
	],
	"indirect-execution": [
		/\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish|dash|ksh|python3?|node|bun|perl|ruby|pwsh|powershell)\b/,
		/\beval\b/,
		/\bbase64\s+(?:-d|-D|--decode)\b/,
		/\b(?:sh|bash|zsh|dash)\s+-[a-z]*c\b/,
		/\b(?:python3?|node|ruby|perl|php)\s+-[ce]\b/,
		/\$\(/,
		/\bxargs\b/,
		/\b(?:iex|invoke-expression)\b/,
		/\bsudo\s/,
		/\bopenssl\s+enc\b|\bxxd\s+-r\b|\bzcat\b|\bgunzip\b/,
	],
	"edits-executable": [
		/(?:^|[\s"'/])(?:\.git\/hooks|\.husky|\.lefthook|lefthook\.yml|\.pre-commit-config\.yaml|\.github\/workflows|\.gitlab-ci\.yml|\.circleci|jenkinsfile|justfile|makefile|dockerfile|hooks\.json|setup\.py|conftest\.py|build\.rs|rakefile|gruntfile|gulpfile)\b/,
		/\b(?:edit|edits|editing|modify|modifying|patch|patching|append|appending|add|adding|write|writing|create|creating|replace|replacing|change|changing|overwrite|overwriting)\b[^\n]{0,60}\.(?:sh|bash|zsh|ps1|bat|cmd)\b/,
		/\bchmod\s+(?:[ugoa]*\+x|[0-7]*[1357][0-7]{0,2})\b/,
		/\b(?:postinstall|preinstall|crontab)\b/,
	],
};

/** Warning tags for a text, each at most once, in the order of WARNING_TAGS. */
export function computeTags(text: string): WarningTag[] {
	const folded = foldText(text);
	return WARNING_TAGS.filter((tag) =>
		PATTERNS[tag].some((pattern) => pattern.test(folded)),
	);
}
