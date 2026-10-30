# Host support

The public package supplies client integrations. The hosted service controls tool availability,
permissions and paid work. No backend implementation is distributed here.

| Feature | Claude Code | Codex | Kimi Code | Grok Build |
|---|---|---|---|---|
| Native plugin and MCP declaration | Yes | Yes | Yes | Yes |
| Shared skills | Yes | Yes | Yes | Yes |
| Commands | Native commands | Plugin skills | Native commands | Native commands |
| Startup instructions | SessionStart context | SessionStart context | sessionStart skill | Skill/MCP instructions |
| Automatic recall | Prompt hook | Prompt hook | Prompt hook | Queued at prompt, emitted at a matching tool boundary |
| Transcript timeline | Claude JSONL | Codex rollout | Main-agent Kimi journal | Unavailable |
| Conversation checkpoint | Bounded head/tail | Bounded head/tail | Bounded active main-agent branch | Unavailable |
| Exit checkpoint | Local reference; retry later | Local reference; retry later | Local reference; resolve and retry later | No supported transcript reader |
| Model-request observation | Not installed | Native observer events | Not installed | No matching native event |

All captures omit media bytes and encrypted/private reasoning. Length, record and format bounds are
reported. A conversation checkpoint is a selected conversation record, not an exact copy of every
tool output. Native capture and automatic recall require a usable `ESTELLE_API_KEY` in the agent's
environment; an unrelated MCP OAuth login does not prove the hooks use the same account.

Rooms also needs the server to recognize the host identity and issue this session's proof. New
Kimi/Grok client packaging alone cannot update a server's host allowlist. Local sessions remain
observed and reached on their supported hook cycle; this package does not take over another terminal.

The six monitor tools expose health, issues, logs, alert rules and uptime reads. A command named
`monitor` does not add notification-recipient editing or incident mutations absent from the server.

Runtime state is separate from immutable installed files and partitioned by the credential. Retry
spools, queues and capture gaps remain local until the appropriate operation is acknowledged.

Source contracts and native test versions are linked in [research](research).
