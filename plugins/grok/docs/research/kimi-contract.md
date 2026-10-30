# Kimi Code integration contract

Checked 30 October 2026 against official MoonshotAI/kimi-code source at
`a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55` and installed `kimi --version`: `2.3.0`.
The installed release tag `@moonshot-ai/kimi-code@2.3.0` resolves to
`b5e28fd6beac752a2cdcc0ff2f5fdf40e6494fbb`. Manifest schemas, hook event names,
prompt-output parsing and the session-index record fields used here agree at both commits.
This research did not install a plugin or invoke a model.

## Native packaging

- Root `kimi.plugin.json`, or `.kimi-plugin/plugin.json`; root takes precedence.
- `skills`, `agents`, and `commands` take `./` paths inside the plugin. Resolved paths
  outside the plugin are rejected. Bundle the runtime inside each package.
- `sessionStart: {"skill":"estelle"}` injects the named plugin skill into the main
  agent on startup/resume. It does not execute a hook.
- `systemPromptPath` can contribute a UTF-8 file, capped at 32 KiB.
- `mcpServers.estelle` may use `{"transport":"http","url":"https://api.fatelabs.ca/mcp","auth":"oauth"}`.
  OAuth login is provided by Kimi; static credentials need not be packaged.
- `hooks` is an array. Each entry accepts only `event`, optional `matcher`, `command`,
  and optional integer `timeout` (1–600 seconds). `async` is invalid.
- Hook commands run in the installed plugin root. `KIMI_PLUGIN_ROOT` and
  `KIMI_CODE_HOME` are supplied. The stdin `cwd` is the actual local project directory.

Source: [manifest parser](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/app/plugin/manifest.ts),
[hook configuration schema](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/features/externalHooks/configSection.ts),
[plugin hook environment](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/app/plugin/manager.ts).

## Install, update and commands

In Kimi:

```text
/plugins install <local-directory-or-GitHub-URL>
/plugins info estelle
/reload
```

Installation copies local content into `$KIMI_CODE_HOME/plugins/managed/<id>`.
Editing the source directory does not update that copy. Reinstall to update it.
GitHub URLs support a repository, branch, commit or subdirectory; a bare repository
uses its latest release, falling back to the default branch. `/plugins reload`
reloads installed files; `/reload` or `/new` activates plugin changes for a session.

Commands are Markdown prompts registered as `/estelle:<command>`. `$ARGUMENTS`
is replaced by text after the command. Skills are qualified as `estelle:<skill>`
and explicitly invoked with `/skill:estelle:<skill>`. Commands are prompts, not
additional backend tools or guaranteed task completion.

Source: [official plugin documentation](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/docs/en/customization/plugins.md).

## Hook envelope and output

Payload base fields: `hook_event_name`, `session_id`, `session_title`, `client_type`,
`cwd`. Tool hooks add `tool_name`, `tool_input`, `tool_call_id`; successful tool
output is capped by Kimi at 2,000 characters. Only top-level field names are
converted to snake case. Native tools are `Bash`, `Read`, `Write`, `Edit`, `Grep`,
`Glob`. File arguments use `path`; Bash uses `command`; Edit uses `old_string`
and `new_string`. Prompt input is an array of content parts; text parts carry `text`.

`UserPromptSubmit` appends a successful hook's text to context. Return
`{"message":"context"}`. Claude's `hookSpecificOutput.additionalContext` is not
Kimi's context contract: it parses as structured output but contributes no text.
`SessionStart`, `SubagentStart`, and `PreCompact` hook stdout cannot inject context.
Use `sessionStart.skill` for initial instructions and `UserPromptSubmit` for recall.
`PreToolUse`, `Stop`, and `UserPromptSubmit` can block; observation events cannot.
Exit 0 allows; exit 2 intentionally blocks; other errors fail open. The adapter
does not make a new grounding gate or attempt to intercept hidden reasoning.

Supported events: PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest,
PermissionResult, UserPromptSubmit, UserPromptQueued, TurnStarted, Stop,
StopFailure, Interrupt, SessionStart, SessionEnd, SessionHeartbeat,
SubagentStart, SubagentStop, TaskStarted, PreCompact, PostCompact, Notification.

Source: [hook trigger serialization](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/features/externalHooks/internal/matchHooks.ts),
[output parsing](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/features/externalHooks/internal/runHook.ts),
[prompt context handling](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/features/externalHooks/internal/userPrompt.ts),
[agent hook wiring](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/features/externalHooks/agent/agentExternalHooksService.ts).

## Transcript discovery and limits

Kimi supplies no `transcript_path` in its hook payload. The adapter only resolves
this session's exact `sessionId` and `workDir` in `$KIMI_CODE_HOME/session_index.jsonl`.
The registry is capped at 2 MB/10,000 lines. A bound, missing record, duplicate
conflicting record, or unavailable file returns unavailable; it never means the
conversation was empty or fully captured. The resolver does not walk history.
The registered directory and real file must stay inside the configured Kimi home
and its `sessions` subtree. The legacy main-agent wire file is
`<sessionDir>/agents/main/wire.jsonl`; records include `context.append_message`.

Upstream also contains a newer tree-based persistence format. A missing legacy
wire file must not be called a successful capture. The resolver does not parse
the new tree store or capture subagent wire files. These are explicit capture
coverage limits, separate from native MCP access.

Source: [session index](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/app/workspace/workspaceAlias.ts),
[scope addressing](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/workspace/sessionLifecycle/internal/addressing.ts),
[wire persistence](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/wire/wireService.ts),
[new persistence migration](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/human/persist/v2/migrate.ts).

## Checks

`node --test test/kimi.test.mjs`: eight tests pass. Fixtures cover the native
envelope, text extraction, file arguments, context output, exact registry lookup,
missing/oversized records, path refusal, conflicting entries, and tree-only absence.
A temporary mutation replacing output `message` with `additionalContext` fails
the named context contract test. This measures adapter behavior, not live model
or hosted API behavior. No real user transcripts or credentials were read.
