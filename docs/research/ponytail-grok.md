# Ponytail reference and Grok Build contract

Checked 30 October 2026. Ponytail is pinned at `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846`. Official xAI Grok Build source is pinned at `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`. The installed executable reports `grok 1.0.41 (4220f3b224a6) [stable]`; that short commit is not resolvable in the public source repository. Source findings below describe the pinned public implementation. Installed help and manifest validation were checked separately; they do not establish that every latest-source event exists in 1.0.41.

## What Ponytail actually packages

Ponytail's Grok integration is intentionally **skills only**. Its root `plugin.json` contains a name; `.grok-plugin/marketplace.json` points at the `skills` subdirectory, which has its own manifest. The Grok test explicitly checks that this adapter declares neither hooks nor MCP servers. It relies on skill activation because passive lifecycle output cannot inject instructions. `.grok-plugin/marketplace.json` is a catalogue, not a magic hook implementation.

The Kimi manifest points at the shared skills and `systemPromptPath: "./AGENTS.md"`. It does not declare hooks. Claude/Codex have explicit host manifests and a shared hook file. Thus the repository demonstrates varied native packaging, not equal lifecycle capabilities on every host. Its own portability document describes these differences.

Sources: [Grok catalogue](https://github.com/dietrichgebert/ponytail/blob/96608e078b2d5ea607c5c3b8b5a54d1c1fba6846/.grok-plugin/marketplace.json), [Grok package tests](https://github.com/dietrichgebert/ponytail/blob/96608e078b2d5ea607c5c3b8b5a54d1c1fba6846/tests/grok-plugin.test.js), [Kimi manifest](https://github.com/dietrichgebert/ponytail/blob/96608e078b2d5ea607c5c3b8b5a54d1c1fba6846/.kimi-plugin/plugin.json), [host portability record](https://github.com/dietrichgebert/ponytail/blob/96608e078b2d5ea607c5c3b8b5a54d1c1fba6846/docs/agent-portability.md).

Useful engineering choices for Estelle:

- Keep one shared skill catalogue with thin host manifests and explicit capability limits.
- Test package inventory and host output envelopes, including events that must emit no model context.
- Keep mutable state in host data directories; distinguish project and session state to prevent concurrent sessions overwriting one another.
- Avoid redundant context when a host already loads equivalent standing instructions.
- Finish a process's stdout write before exiting so the host receives the full JSON document.

Ponytail's code-reuse/stdlib/minimal-change ladder substantially overlaps the existing Axiom instructions supplied to this session. Do not copy another broad ruleset into every prompt or claim its benchmarks apply to Estelle. Preserve the existing trust-boundary validation, data-loss protection and complete caller updates. The inspected runtime also documents a shared-mode limitation between sessions in the same project; use real session identity where isolation matters.

Sources: [shared runtime and state limitations](https://github.com/dietrichgebert/ponytail/blob/96608e078b2d5ea607c5c3b8b5a54d1c1fba6846/hooks/ponytail-runtime.js), [minimal-change skill](https://github.com/dietrichgebert/ponytail/blob/96608e078b2d5ea607c5c3b8b5a54d1c1fba6846/skills/ponytail/SKILL.md).

## Native Grok package

Grok's canonical manifest is root `plugin.json`; fallbacks are `.grok-plugin/plugin.json`, then `.claude-plugin/plugin.json`. Convention defaults are `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, and `.mcp.json`. Manifest fields include `skills`, `commands`, `agents`, `hooks`, `mcpServers`, and `lspServers`. Component paths remain within the installed plugin. Hooks and MCP declarations may be paths or inline objects. A dedicated Grok package root avoids loading another host's convention hook file accidentally.

```json
{
  "name": "estelle",
  "version": "0.0.1",
  "skills": "./skills",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

The hosted MCP connection can use the same environment variable as the hook runner:

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

This server field is snake_case. The underlying HTTP transport adds Bearer authorization from that named variable. No key belongs in the public package. The production backend stays hosted and private.

Sources: [manifest schema and resolution](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-agent/src/plugins/manifest.rs#L1), [native MCP configuration](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-config/src/mcp_server_config.rs#L28).

Installed help confirms:

```sh
grok plugin validate /path/to/plugin
grok plugin install owner/repository@v0.0.1#plugins/grok --trust
grok plugin enable estelle
grok plugin update estelle
grok plugin details estelle
```

The exact release source/path must match the published layout. `--trust` grants native plugin consent; installation is not a source-validation step. `grok plugin marketplace add` and `grok plugin marketplace update` are available for catalogue distribution. Use `/plugins` and reload or start a new session to pick up a new installation. Nothing was installed or trusted in this source study.

## Native hook differences

Grok has 15 canonical events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionDenied, Stop, StopFailure, StopCancelled, Notification, SubagentStart, SubagentStop, PreCompact, PostCompact, SessionEnd. SubagentEnd is a compatibility alias of SubagentStop. There are no PreModelRequest/PostModelRequest events in the inspected native event definition.

The canonical stdin envelope uses **camelCase**: `hookEventName` contains a snake_case event value, `sessionId`, `workspaceRoot`, `timestamp`, optional `transcriptPath`, optional `promptId`, and event payload. Tool payloads use `toolName`, `toolInput`, `toolUseId`, and `toolResult`. Current source adds compatibility snake_case aliases; `hook_event_name` unusually carries the PascalCase event value. CamelCase stays authoritative. Older hosts may omit aliases entirely.

Subagents use `subagentId` and `subagentType`; `sessionId` must not be silently replaced by a child identifier. `promptId` is the native request identifier, not a newly generated Estelle turn. Optional transcript paths can be absent. Tool payloads expose truncation flags; bounded input is not proof of complete content.

| Boundary | Actual native behavior |
|---|---|
| SessionStart, SubagentStart, Notification, failure/denial events, compaction, SessionEnd | Observe; stdout cannot inject model context |
| UserPromptSubmit | May block with reason; the reason is user-facing, not injected context |
| PreToolUse | Permission/rewrite and additionalContext supported |
| PostToolUse | additionalContext and feedback; output replacement supports updatedToolOutput or updatedMCPToolOutput |
| Stop / SubagentStop gate phase | additionalContext/block-stop can keep the model working; avoid unconditional continuation loops |

For verified context-bearing boundaries use:

```json
{"hookSpecificOutput":{"additionalContext":"Context from Estelle"}}
```

Do not emit that at SessionStart or UserPromptSubmit and then claim automatic recall occurred. Use a skill/MCP invocation or a verified later tool boundary. The adapter returns null at passive boundaries. Stop context is supported by the host but should only be emitted when continuation is intended. SubagentStop has separate gate and observe phases; only the gate phase can affect continuation.

Hook subprocesses receive `GROK_PLUGIN_ROOT`, `GROK_PLUGIN_DATA` and Claude compatibility aliases, plus `GROK_SESSION_ID`, `GROK_HOOK_EVENT`, `GROK_HOOK_NAME`, and `GROK_WORKSPACE_ROOT`. Store state in the writable data directory. Native handlers support command and HTTP transports. Trust and enablement remain native host responsibilities.

Sources: [event enum, envelope and aliases](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-hooks/src/event.rs#L75), [gate/stop/post-tool output parsers](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-hooks/src/runner/mod.rs#L60), [prompt output parser](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-hooks/src/runner/command.rs#L851), [passive dispatch](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-hooks/src/dispatcher.rs#L940), [plugin hook environment](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-agent/src/plugins/hooks_adapter.rs#L171).

## Evidence and remaining limits

`adapters/grok.mjs` and `test/grok.test.mjs` implement the shared normalize/formatContext interface with native event mapping and camelCase priority. Six tests pass, including conflicting alias identity, no invented transcript, all event mappings, passive-event non-injection and MCP output replacement restrictions. A temporary deliberate mutation allowing SessionStart injection made the context-boundary test fail with exit 1.

The installed `grok plugin validate` accepted a synthetic native manifest and reported one skill directory, hooks and MCP servers (exit 0). The same fixture with an invalid plugin name was rejected (exit 1). That validates the installed manifest/inventory path only; it did not execute hooks, authenticate MCP, start a model session or prove complete session capture. A Grok transcript dialect has not been verified here; never feed Grok transcripts through the Claude/Codex mapper based on the presence of `transcriptPath` alone. Live native payload and authenticated runtime probes remain necessary before advertising complete Grok capture or parity with the other hosts.
