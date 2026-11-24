# Harness source checks for the agent mailbox (Claude Code and Antigravity)

Date: 2026-11-25. Status: facts, not design. This file answers the harness items of spec
section 15, "Required checks at the source", which were agreed to be done before plan 2. It
changes no spec rule. Where a finding contradicts a rule, it is listed in section 1 for the
owner to decide.

Versions read: Claude Code 2.1.331 and the Antigravity CLI `agy` 1.5.16 (the Antigravity IDE
1.107.0 is a separate product, see section 5). On Linux, x86-64, 2026-11-25.

## How each fact is marked

- SOURCE: read in the harness's own installed files (the embedded code or text), by `strings`
  and `grep` from outside; nothing was built or run for it.
- DOC: read in the vendor's published documentation, which was fetched as the raw page.
- MEASURED: observed in a run on 2026-11-25, in a throwaway project directory with a logging
  hook, using only per-session flags. Neither harness's own settings were edited.
- HYPOTHESIS and UNKNOWN: named as such; never to be built on.

A WebFetch summary is not a source: it answered "not in the text" for facts that the raw page
holds. Citations to doc pages are to the raw page.

## 1. Findings that need an owner decision

Each is a place where a spec rule rests on an assumption that this check did not confirm.
Nothing was patched in the spec.

1. **Sub-agents on Antigravity do not inherit the parent's session (9.2 rule 5). MEASURED.**
   A sub-agent started with `invoke_subagent` gets its own conversation id. Its hook payloads
   and its `ANTIGRAVITY_CONVERSATION_ID` carry that new id. The payload has no field naming
   the parent (the keys are `artifactDirectoryPath`, `conversationId`, `cwd`, `hookEventName`,
   `lastUserInput`, `modelName`, `stepIdx`, `toolCall`, `transcriptPath`, `workspacePaths`).
   The parent's hooks do fire for the sub-agent's tool calls. So a gate that marks the parent
   session as having read sees the sub-agent as a known session that was never marked, and
   does not confirm. On Claude Code the opposite holds (section 3): the sub-agent's payload and
   variable carry the main session's id, and `agent_id` tells the sub-agent apart. The
   parent is recorded by the harness: its own conversation API (`GetConversation`) returns
   `parentConversationId` and `rootConversationId` (SOURCE: the harness's embedded skill text),
   and a shell call has the address and token for it. A hook process does not: MEASURED, its
   environment held only `ANTIGRAVITY_CONVERSATION_ID` of the `ANTIGRAVITY_` variables.
2. **A hook that fails does not block on Claude Code by default (9.2 rule 3, "where the human
   cannot be asked, the action is denied"). DOC.** A crash, a time-out or any exit code other
   than 0 or 2 lets the call go ahead. The gate hook must set `"onFailure": "block"` (version
   2.1.295 or later) and signal a block by exit 2 or by valid JSON. On Antigravity the opposite
   holds. MEASURED: a PreToolUse hook that exits non-zero, prints text that is not JSON, or
   cannot be started blocks the tool call.
3. **Under the operator's "approve everything" flag Antigravity runs a call the hook sent to
   "ask" (9.2 rule 3, "where the human cannot be asked, the action is denied"). MEASURED, print
   mode only.** With `--dangerously-skip-permissions`, a PreToolUse hook that returned
   `force_ask` did not stop the command: it ran. Without the flag, print mode denied it, also
   when an allow rule matched (MEASURED). So `force_ask` does what 9.2 rule 3 says about a
   cached permission (it overrides an allow rule) but not about the flag, which is not a cached
   permission but a switch the human sets for the whole run. The interactive behaviour under the
   flag was not run. On Claude Code the binary says a hook "ask" is checked before the
   bypass-mode allow (SOURCE), but this was not run (see section 6).
4. **No event runs only after the human approved and before the tool runs, on either harness
   (8.5 and the experiment of section 15). SOURCE and MEASURED.** A PreToolUse hook runs before
   the human is asked, and what it wrote stays when the human denies. MEASURED on both: a
   marker file written by the hook remained after a denial, and an immediate retry of the same
   command asked again and wrote a second marker. So a hook cannot record a confirmation as
   granted: whatever it writes exists whether or not the human approved, which is what 8.5 says
   must not happen. The proof of approval has to arrive with the approved command itself or in
   an event after execution. One candidate, not run: the hook rewrites the command it sends to
   the human so that it carries a one-time value (Claude Code `updatedInput`, Antigravity
   `overwrite`, both documented), so that only an approved call can hand that value to the
   client. Open: whether the human sees the rewritten command in the prompt, and whether the
   rewrite survives approval. A leftover marker is harmless only while every later call passes
   through the gate hook again, which is the stated limit of 9.2 rule 4.
5. **A hook can be switched off by the user's own settings or flags on Claude Code (9.2 rule
   4 already says the gate is best effort).** The ways are listed in section 3. They are not
   a defect of the spec, but "denied when the human cannot be asked" holds only while the gate
   hook runs.

Confirmed as the spec says: Claude Code exports `CLAUDE_CODE_SESSION_ID` and Antigravity
exports `ANTIGRAVITY_CONVERSATION_ID` to shell calls (9.2 rule 5). On Antigravity the variable
is also present in the hook's own process and equals the payload's `conversationId` (MEASURED).

## 2. Rule locations (9.3)

|                         | Claude Code                                                                                                           | Antigravity CLI                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User-global rule file   | `~/.claude/CLAUDE.md` and `~/.claude/rules/*.md` (DOC, SOURCE)                                                        | `~/.gemini/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.gemini/config/AGENTS.md`; modular `~/.gemini/config/rules/*.md` with `trigger: always_on` frontmatter (DOC, SOURCE)    |
| Project                 | `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`, `CLAUDE.local.md`; `AGENTS.md` only when no `CLAUDE.md` (DOC) | `AGENTS.md` or `GEMINI.md` in any directory up to the repo root; `.agents/AGENTS.md`; `.agents/rules/*.md` (DOC, SOURCE)                                                 |
| Managed or enterprise   | `/etc/claude-code/CLAUDE.md` on Linux (DOC, SOURCE)                                                                   | no rule file found (UNKNOWN)                                                                                                                                             |
| Loaded in every project | yes, for the user-global files (DOC)                                                                                  | yes (DOC, SOURCE)                                                                                                                                                        |
| Hook file               | settings files, plugin `hooks/hooks.json` (DOC)                                                                       | `.agents/hooks.json` in the workspace and `~/.gemini/config/hooks.json`, or a plugin's `hooks.json` at its root. Hooks in the CLI's `settings.json` are not loaded (DOC) |

Limits that bear on the always-on rule: on Claude Code the built-in Explore, Plan and web-fetch
sub-agents start without any `CLAUDE.md`, and `--bare`, a safe-mode variable or a "managed-only"
setting can leave the files out (DOC). On Antigravity each rule file is capped at 24,000 bytes
and always-on and global rules share a 20,000-token budget; over budget they become pointers
(SOURCE). An adapter's rule file must stay small. The Antigravity binary's own safety judge
treats edits to `hooks.json`, `settings.json` and `~/.gemini/config/` as tampering (SOURCE), so
the adapter must be installed by the human's command, not by the agent.

## 3. Claude Code

- **Session id.** Variable `CLAUDE_CODE_SESSION_ID`, set in shell calls, hook processes and
  stdio MCP servers. In a hook it equals the payload field `session_id` (MEASURED). Settings
  `env` cannot override it (SOURCE). It stays the same across `--resume` (DOC) and across
  `/compact` (MEASURED: the SessionStart hook fired again with source `compact` and the same
  id). It changes on `/clear`, and `--fork-session`, `/fork` and `/branch` give a new id to a
  conversation that inherits the old one (DOC), so a mark keyed on the session would not
  follow a fork.
- **Events.** 33 hook events (SOURCE, the same list in DOC), among them `SessionStart`,
  `PreToolUse`, `PostToolUse`, `PermissionRequest`, `SubagentStart`, `SubagentStop`.
- **Payload.** JSON on stdin (DOC). Common fields: `session_id`, `transcript_path`, `cwd`,
  `permission_mode`, `agent_id` and `agent_type` (only inside a sub-agent), `hook_event_name`
  (MEASURED for the keys that were logged). PreToolUse adds `tool_name`, `tool_input`,
  `tool_use_id`. Shell tool: `Bash` (and `PowerShell` on Windows), command text in
  `tool_input.command`. File edits: `Edit` and `Write` (and `NotebookEdit`). MCP tools:
  `mcp__<server>__<tool>`.
- **Forcing the human.** A PreToolUse hook prints
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"<text>"}}`
  and exits 0. MEASURED: the prompt shows the reason text in full, labelled
  "Hook PreToolUse:Bash requires confirmation for this command", with the source label
  `[settings]`, and offers Yes or No. A matching deny rule still wins (SOURCE, DOC). Exit 2
  blocks. `defer` is for print mode only; do not use it for the gate (SOURCE).
- **Cached permission.** A hook "ask" is not consulted against allow rules or "always allow"
  grants (SOURCE: the function that handles it only looks for a deny). Not run with an allow
  rule present.
- **No human reachable.** In `-p` mode with no `--permission-prompt-tool` and no
  `canUseTool`, an "ask" is denied unless a PermissionRequest hook approves it (DOC). Any
  PermissionRequest hook can approve what the gate sent to "ask"; so can a host that supplies
  `--permission-prompt-tool` or `canUseTool`, and a mod in setups without managed settings
  (DOC). `dontAsk` mode turns an "ask" into a denial (DOC).
- **Switching hooks off.** `claude -p --bare` runs no hook from the user's settings; the
  settings key `disableAllHooks`; `allowManagedHooksOnly`; `CLAUDE_CODE_SAFE_MODE=1`. `EndConversation`
  calls skip PreToolUse (DOC).
- **Order.** PreToolUse hooks, then deny and ask rules, then PermissionRequest hooks on an
  "ask", then the human, then the tool, then PostToolUse (SOURCE, DOC). `PermissionRequest`
  fires before the human answers, not after.
- **Sub-agents.** The payload's `session_id` and the variable in the sub-agent's shell hold the
  main session's id; `agent_id` is the sub-agent's own (MEASURED for the payload, the variable
  and the hook: PreToolUse and PostToolUse fired for the sub-agent's command). A hook "ask"
  inside a foreground sub-agent reached the human in the main prompt (MEASURED). A background
  sub-agent was not run.

## 4. Antigravity CLI (`agy`)

- **Session id.** Variable `ANTIGRAVITY_CONVERSATION_ID` in shell calls (SOURCE: the text the
  binary embeds for its own skills; it is not in the public docs, so treat it as an unversioned
  contract). MEASURED: it is also set in the hook process and equals the payload's
  `conversationId`. Other variables the shell receives: `ANTIGRAVITY_LS_ADDRESS`,
  `ANTIGRAVITY_CSRF_TOKEN` (a secret; never log it), `ANTIGRAVITY_PROJECT_ID`. `/fork` makes
  a new conversation (SOURCE, changelog). Stability across `--conversation` and `/compact` was
  not measured.
- **Events.** Six: `SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`,
  `PostInvocation`, `Stop` (DOC, SOURCE). SessionStart fired for each new conversation, a
  sub-agent's included (MEASURED).
- **Payload.** JSON on stdin, camelCase keys. MEASURED keys: `artifactDirectoryPath`,
  `conversationId`, `cwd`, `hookEventName`, `lastUserInput`, `modelName`, `transcriptPath`,
  `workspacePaths`, and on tool events `stepIdx` and `toolCall` (`id`, `name`, `args`). The
  hook's working directory is the directory that holds `hooks.json`, not the project root
  (MEASURED). Shell tool: `run_command`, command text in `toolCall.args.CommandLine`
  (MEASURED). File edits: `write_to_file`, `replace_file_content`,
  `multi_replace_file_content` (DOC). Sub-agent tools: `invoke_subagent`, `send_message`.
  The fields `parentConversationId`, `rootConversationId` and `agentName` exist in the
  harness's protobuf types and its conversation API (SOURCE) but are not in the published hook
  payload (DOC) and were absent from the payloads of a sub-agent's events (MEASURED). The tool
  list also holds `call_mcp_tool` (SOURCE, a string count only); a gate that classes MCP calls
  must match it.
- **Forcing the human.** A PreToolUse hook prints `{"decision":"force_ask","reason":"<text>"}`
  on stdout; there is no exit-code contract (DOC, SOURCE). `force_ask` ignores cached
  permissions (DOC, SOURCE); `ask` respects "always allow". MEASURED in print mode: with an
  allow rule matching the command, the same command without the hook ran, and with a hook
  returning `force_ask` it was denied. Under `--dangerously-skip-permissions` it ran (finding 3
  of section 1). Whether the reason text is shown in the interactive prompt was not run.
- **Hook failure.** A hook that exits non-zero, prints non-JSON, or cannot start blocks the
  tool call with an error naming the hook (MEASURED: exit 2 from a missing script, exit 3, and
  plain text on stdout).
- **No human reachable.** Print mode soft-denies a call that needs approval and exits 0; the
  default permission needs an allow rule or the skip flag (MEASURED, SOURCE).
- **Order.** The hook runs before the tool and before any approval; there is no event between
  approval and execution (SOURCE, MEASURED, as in finding 4).

## 5. The Antigravity IDE

The IDE (VS Code based, 1.107.0) bundles an older language server. Its hook engine exists, but
its result type has allow, deny reason and overwrite fields and no `force_ask` and no
`SessionStart` (SOURCE: symbol names, count zero for those strings). So the CLI contract does
not carry over. The adapter claims the CLI only; the IDE must be measured before it is claimed.

## 6. Not settled; each needs a run

1. A Claude Code hook "ask" under `bypassPermissions`. The run needs the mode's warning dialog,
   which stores an acceptance in the user's own Claude Code configuration, so it was left to the
   owner.
2. A Claude Code hook "ask" under plan mode; the length limit of `permissionDecisionReason`;
   a hook "ask" in a background sub-agent; whether SessionStart on a fork names the parent.
3. Antigravity: the interactive prompt (is the `reason` shown, does a denial leave anything),
   stability of the id across resume and `/compact`, whether SessionStart fires on resume,
   whether `force_ask` is honoured under `always-proceed`, and whether the transcript path links
   a sub-agent to its parent.
4. Managed rule files on Antigravity.
5. Whether a hook's rewritten command is shown to the human and survives approval, on both
   harnesses (finding 4); and whether a client run from a shell call can find the root
   conversation through the conversation API with its own variable, token and address on
   Antigravity (finding 1).

## 7. How this was done

Two read-only research agents read the installed files and the vendor docs; the driver
re-checked the load-bearing claims against the installed files (the hook-ask and deny-rule
strings and the session-id handling on Claude Code, the `force_ask` and conversation-id
strings on `agy`). The second agent (agy) then read the file against both binaries; it found
three overstatements, which are folded: the sub-agent fields were called documented, the skip
flag was called a cached permission, and finding 4 concluded too much. The experiments ran in a throwaway directory outside the repository, with a
logging hook and per-session flags only. They used a small model on Claude Code and the default
model on `agy`.
