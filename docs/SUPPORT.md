# Host support

| Feature | Claude Code | Codex | Kimi Code | Grok Build | Cursor |
|---|---|---|---|---|---|
| Native plugin and hosted MCP | Yes | Yes | Yes | Yes | Yes |
| Skills | Yes | Yes | Yes | Yes | Yes |
| Commands | Native | Plugin skills | Native | Native | Native |
| Startup instructions | Hook context | Hook context | Startup skill | Skills/MCP | Rule and hook context |
| Automatic recall | Prompt hook | Prompt hook | Prompt hook | Next matching pre-tool hook | Next matching post-tool hook |
| Transcript capture | Bounded JSONL | Bounded rollout | Bounded main-agent journal | Bounded JSONL (inferred dialect) | Bounded JSONL (inferred dialect) |
| Checkpoints | Bounded conversation | Bounded conversation | Active main-agent branch | Bounded conversation (inferred dialect) | Bounded conversation (inferred dialect) |
| Exit save | Reference; retry later | Reference; retry later | Reference; retry later | Reference; retry later | Reference; retry later |
| Model-request observation | No | Native observers | No | No | No |

Hooks require a usable `ESTELLE_API_KEY`; a separate MCP OAuth login does not establish hook
identity. Captures omit media bytes and private/encrypted reasoning. Bounds, missing transcripts,
queued uploads and unsupported formats are not complete history.

Grok and Cursor prompt hooks cannot inject context. Recall is queued for a matching supported
tool boundary; a reply with no tool call may receive none. Cursor stop hooks never auto-continue
the agent. Grok and Cursor transcript readers are inferred from the hook payload contract and
third-party observations of the on-disk JSONL, not yet verified against a live host session: their
checkpoints are marked partial, their event times are capture time (the transcript lines carry no
verified timestamps), unrecognized lines are skipped, and Cursor does not record tool outputs.

Rooms needs server-side host support, an authenticated owner and a session proof. Native hook
identity and Cursor's `user_email` are not substitutes for that proof or permission to share.
Plugins do not take over another terminal or bypass member/admin permissions.

The server exposes the tools available to your account. Read its live schemas before calling an
action. Public packages do not deploy or contain the hosted backend.

Use `node runtime/cli.mjs doctor` from a clone for credential-presence and local status diagnostics.
Use `node scripts/probe.mjs` with the key in your environment for read-only MCP setup checks;
it makes no model call. Neither diagnostic alone proves a successful transcript upload.
