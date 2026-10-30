# Codex integration contract

Checked 30 October 2026. The installed executable reports `codex-cli 0.166.0`. Its read-only `plugin --help`, `plugin add --help`, and marketplace add/upgrade help were checked. No installation, approval, configuration, credential, or transcript was read or changed during this source study.

Official release tag `rust-v0.166.0` resolves to commit **`6ff1e1ca3b30fc8b914720681fcf5fe62e95f856`**. Links below pin that release. Official `main` was also pinned at `275a9a89b6a2689b5b5a8b3b4aa5dc3c02e7d64a`; the examined hook declarations, model-request behavior, plugin manifest parser, marketplace parser, content fingerprint and approval implementation were byte-identical to the release. This establishes the reported-version source contract, not a cryptographic attestation of the installed executable.

## Package layout

Codex discovers `.codex-plugin/plugin.json`, then `.claude-plugin/plugin.json`, then `.cursor-plugin/plugin.json`. Use an explicit Codex manifest so other hosts do not accidentally receive host-specific hook configuration. A recognized root Agent Plugins v1 `plugin.json` has separate precedence and convention rules; it is unnecessary for this package.

```json
{
  "name": "estelle",
  "version": "0.0.1",
  "description": "Estelle for Codex",
  "skills": "./skills",
  "hooks": "./hooks/codex.json",
  "mcpServers": "./.mcp.json"
}
```

Legacy native manifest fields include `name`, `version`, `description`, `keywords`, `skills`, `mcpServers`, `hooks`, `apps`, `interface`, and `extensions`. Paths use `./` and stay below the plugin root. Skills may be a path or path list. Hooks may be a path, path list, inline hooks object, or inline object list. MCP may be a path or inline server object. Native defaults are `skills/`, `hooks/hooks.json`, and `.mcp.json`. The legacy command migration mechanism produces skills; do not promise a separate arbitrary slash-command execution runtime. Ship user-facing workflows as skills.

Sources: [manifest discovery order](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/exec-server-protocol/src/protocol.rs#L55), [manifest parser](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core-plugins/src/manifest.rs#L48), [resource loading and command migration](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core-plugins/src/loader.rs#L1112).

## Marketplace and commands

Supported marketplace manifest locations, in order: `.agents/plugins/marketplace.json`, `.agents/plugins/api_marketplace.json`, `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json`. A minimal local-in-repository entry is:

```json
{
  "name": "example-marketplace",
  "plugins": [{ "name": "estelle", "source": "./plugins/codex" }]
}
```

The `source` path is relative to the marketplace repository root. Structured local, GitHub, URL, Git-subdirectory and npm sources also exist. Using one public Git repository requires no Rust distribution or npm hook executable.

Verified installed CLI syntax:

```sh
codex plugin marketplace add owner/estelle-plugins --ref main
codex plugin add estelle@example-marketplace
codex plugin list
codex plugin marketplace upgrade example-marketplace
codex plugin add estelle@example-marketplace
```

`marketplace upgrade` refreshes configured Git snapshots. There is no `codex plugin update` command in this version; installing from the refreshed marketplace is the available CLI operation. The commands above document syntax; this study did not execute an install or verify a remote publication.

Sources: [marketplace paths](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core-plugins/src/marketplace.rs#L20), [marketplace data types](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core-plugins/src/marketplace.rs#L995), [CLI commands](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/cli/src/plugin_cmd.rs).

## Hosted MCP and credentials

Use native snake_case server fields inside the camelCase `mcpServers` wrapper:

```json
{
  "mcpServers": {
    "Estelle": {
      "url": "https://api.fatelabs.ca/mcp",
      "bearer_token_env_var": "ESTELLE_API_KEY"
    }
  }
}
```

The harmless fixture is [codex/native-mcp.json](codex/native-mcp.json). `Estelle` preserves the chosen server name; credentials are referenced, never included. The existing HTTPS backend remains hosted. This is a public connection declaration, not a local copy of backend code.

The plugin MCP parser accepts wrapped `mcpServers` or a direct server map. A server uses `url` for Streamable HTTP or `command`/`args` for stdio. It accepts `type: "http"` for compatibility but transport selection follows URL/command fields. Native HTTP fields include `bearer_token_env_var`, `http_headers`, `env_http_headers`, and `http_headers_helper`; the parser does not expand `${ESTELLE_API_KEY}` inside arbitrary HTTP header strings. `env_http_headers` maps header names to environment-variable names and does not add a Bearer prefix; use `bearer_token_env_var` for that case. OAuth is supported by Codex, but mixing OAuth identity with a different API-key hook identity would require an explicit account check in the integration.

This fixture was compared against the pinned parser and native field definitions. It was not run through a compiled upstream parser, installed in Codex, or used for authenticated HTTP in this study.

Sources: [plugin MCP parser](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/codex-mcp/src/plugin_config.rs#L43), [compatibility normalization](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/codex-mcp/src/plugin_config.rs#L276), [native MCP fields](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/config/src/mcp_types.rs#L391).

## Hook events and output

The native hook object is `{ "hooks": { "EventName": [{ "matcher": "...", "hooks": [{ "type": "command", "command": "node ...", "timeout": 10 }] }] } }`. Handler fields include `commandWindows`, `async`, `statusMessage`, and `additionalContextLimit`. `command` handlers and `mcp_tool` handlers are implemented; `prompt` and `agent` handler types parse but are explicitly skipped as unsupported. MCP-tool hooks do not run at `SessionEnd`.

| Event | Relevant input beyond common identity | Supported output use |
|---|---|---|
| SessionStart | source: startup/resume/clear/compact/fork | additionalContext; stop continuation |
| UserPromptSubmit | prompt, turn_id | additionalContext; block with reason |
| PreToolUse | tool_name, tool_input, tool_use_id, turn_id | additionalContext, permissionDecision, updatedInput |
| PermissionRequest | tool_name, tool_input, turn_id | allow/deny decision; permission-specific fields |
| PostToolUse | tool_name, tool_input, tool_response, tool_use_id, turn_id | additionalContext, updatedMCPToolOutput, block feedback |
| SubagentStart | agent_id, agent_type, turn_id | additionalContext; no child launch cancellation guarantee |
| SubagentStop | agent_id/type, agent_transcript_path, last_assistant_message, stop_hook_active | stop/block semantics |
| Stop | last_assistant_message, stop_hook_active, turn_id | block with reason to continue; guard against loops |
| PreCompact / PostCompact | trigger: manual/auto, turn_id | lifecycle/control messages; no additionalContext |
| SessionEnd | reason (currently other) | command side effects; stdout is not model context |
| Interrupt | turn_id | systemMessage; short teardown deadline |
| PreModelRequest | model, turn_id | observer only; no model-context injection |
| PostModelRequest | model, turn_id, status, error, token_usage | observer only; no model-context injection |

Common inputs include `session_id`, `cwd`, and nullable `transcript_path`; most active-turn events include `model` and `turn_id`. `permission_mode` appears on applicable interactive events. Subagent context is optional on several ordinary events. A hook receives JSON over stdin. Successful additional-context output is exactly:

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Context from Estelle"}}
```

Only SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, and SubagentStart accept `additionalContext`. SessionStart/UserPromptSubmit also accept successful plain stdout as context; use structured output to avoid accidental context from diagnostics. `systemMessage` is a UI message, not a substitute for model context. Put diagnostics on stderr. Unknown JSON output fields can fail the strict output parser; event-specific envelopes matter.

`PreModelRequest` runs at a model-request boundary, not inside private reasoning. Its input does not contain the model prompt or hidden thinking. Both model-request hooks log stdout diagnostically and ignore JSON that resembles a control directive. PostModelRequest reports completed/failed/cancelled and token usage or null. Do not advertise these events as an ability to read, rewrite, or block the model's thinking.

Sources: [all 14 events and handler fields](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/protocol/src/hooks.rs#L9), [supported handler dispatch and injection events](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/hooks/src/engine/discovery.rs#L678), [canonical generated input/output schemas](https://github.com/openai/codex/tree/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/hooks/schema/generated), [model-request observer implementation](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/hooks/src/events/model_request.rs#L1).

## Session capture and lifetime

`session_id` is the host thread identity; it is not an Estelle Rooms write credential. Reuse the hook's real identity and backend registration flow. A fork is distinguishable from resume through SessionStart `source`; do not substitute a parent identifier for a newly forked thread.

`transcript_path` can be null. Its presence does not prove every chat turn was persisted or uploaded, and hook payloads themselves are not a full conversation export. SubagentStop supplies `agent_transcript_path` separately from the parent transcript. Track read offsets, upload acknowledgements, gaps, and bounded read limits; completeness must remain a measured claim. This study did not read a real transcript or recover hidden reasoning.

`SessionEnd` defaults to one second and is capped at three; it is forced synchronous even if declared async. Interrupt has the same timeout cap. Other hooks default to 600 seconds when unspecified: declare a shorter integration timeout. Do not defer the only durable checkpoint or full network upload until teardown. PreCompact can trigger a checkpoint, but its output does not inject context into the compacted model; restore through a subsequent supported context hook.

Sources: [SessionStart sources and identities](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/hooks/src/events/session_start.rs#L24), [SessionEnd lifecycle](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/hooks/src/events/session_end.rs#L20), [timeout normalization](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/hooks/src/engine/discovery.rs#L946).

## Approval and the “plugin contents changed” error

Codex checks both the normalized hook declaration and the installed bundle's content fingerprint. The fingerprint includes file paths, entry types, lengths and bytes across the bundle, with specific generated Python/runtime-artifact exclusions. Editing a script, manifest, skill, README, or writing logs/state into the installed plugin can invalidate approval without changing the version. Unsupported entry types, including symlinks, fail the scan.

`plugin contents changed; hook approval required` is a trust-check failure before the command runs. It differs from `hook exited with code 1`, which reports an executed handler's nonzero result. An error string alone does not establish why a particular local plugin changed.

Safe recovery: open `/hooks`, review new/modified handlers, then press `t` to trust the selected handler, or `t` from the event overview to trust all reviewed hooks. Space toggles enabled state; it does not grant trust. The startup consent dialog also offers “Review hooks”, “Trust all and continue”, and “Continue without trusting (hooks won't run)”. Use that native consent flow after installing the intended release. Do not alter trust hashes or disable checks.

Codex supplies `PLUGIN_ROOT` and compatibility `CLAUDE_PLUGIN_ROOT` for installed code, plus `PLUGIN_DATA` and compatibility `CLAUDE_PLUGIN_DATA` for writable plugin state. Store state outside the bundle. In-place cache edits are not an update mechanism. These public hooks run outside the ordinary tool sandbox after approval; trust is consequential.

Sources: [bundle fingerprint](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/hooks/src/engine/plugin_fingerprint.rs#L1), [execution trust check](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/hooks/src/engine/plugin_trust.rs#L1), [native approval UI](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/tui/src/bottom_pane/hooks_browser_view.rs#L530), [startup consent](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/tui/src/startup_hooks_review.rs#L227), [plugin environment variables](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/hooks/src/engine/discovery.rs#L311).

## Local adapter evidence

`adapters/codex.mjs` validates the required host envelope, normalizes all 14 event names, and emits only the five supported additional-context shapes. Its optional PostToolUse replacement uses the exact `updatedMCPToolOutput` field. `test/codex.test.mjs` has six tests covering valid payloads, missing/invalid inputs, all context events, observer/compact non-injection and replacement-event restrictions. A deliberate temporary mutation allowing PreModelRequest injection made the named observer-boundary test fail with exit 1. The unmutated suite passes. This is adapter evidence, not a live Codex install, remote authentication, or end-to-end capture claim.
