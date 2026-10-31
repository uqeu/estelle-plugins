# Estelle plugins

Estelle for Claude Code, Codex, Kimi Code, Grok Build and Cursor. Each host has its own package
under `plugins/`. They connect to `https://api.fatelabs.ca/mcp`.

Requires Node.js 22 or later and `ESTELLE_API_KEY` in the agent's environment. Hooks and MCP use
the same key. No Estelle CLI installation is needed. Version: `0.0.3`.

| Host | Install instructions and copy/paste setup prompt |
|---|---|
| Claude Code | [Claude](docs/install/claude.md) |
| Codex | [Codex](docs/install/codex.md) |
| Kimi Code | [Kimi](docs/install/kimi.md) |
| Grok Build | [Grok](docs/install/grok.md) |
| Cursor | [Cursor](docs/install/cursor.md) |

## Copy a setup prompt

Paste the matching prompt into your coding agent.

<details>
<summary>Claude Code</summary>

```text
Install Estelle for Claude Code from https://github.com/uqeu/estelle-plugins. Follow docs/install/claude.md and install plugins/claude. Replace only old Estelle CLI-backed hooks, preserve unrelated settings, and never display credentials. Use normal plugin approval and a fresh session. Check installation and authenticated MCP separately; explain any setup that still needs me.
```

</details>

<details>
<summary>Codex</summary>

```text
Install Estelle for Codex from https://github.com/uqeu/estelle-plugins. Follow docs/install/codex.md and install plugins/codex. Replace only old Estelle CLI-backed hooks, preserve unrelated settings, and never display credentials. Use normal plugin approval and a fresh session. Check installation and authenticated MCP separately; explain any setup that still needs me.
```

</details>

<details>
<summary>Kimi Code</summary>

```text
Install Estelle for Kimi Code from https://github.com/uqeu/estelle-plugins. Follow docs/install/kimi.md and install plugins/kimi from a local clone using Kimi's native installer. Replace only old Estelle CLI-backed hooks, preserve unrelated settings, and never display credentials. Use normal plugin approval and a fresh session. Check installation and authenticated MCP separately; explain any setup that still needs me.
```

</details>

<details>
<summary>Grok Build</summary>

```text
Install Estelle for Grok Build from https://github.com/uqeu/estelle-plugins. Follow docs/install/grok.md and install plugins/grok. Replace only old Estelle CLI-backed hooks, preserve unrelated settings, and never display credentials. Use normal plugin approval and a fresh session. Check installation and authenticated MCP separately; explain any setup that still needs me.
```

</details>

<details>
<summary>Cursor</summary>

```text
Install Estelle for Cursor from https://github.com/uqeu/estelle-plugins. Follow docs/install/cursor.md and install plugins/cursor through Cursor's editor. Replace only old Estelle CLI-backed hooks, preserve unrelated settings, and never display credentials. Use normal plugin approval and a fresh session. Check installation and authenticated MCP separately; explain any setup that still needs me.
```

</details>

Includes MCP connections, coding skills, recall hooks and local credential-pattern protection.
Claude, Codex and Kimi also support bounded conversation capture. Grok and Cursor transcript
capture is unavailable; neither should be described as a complete handoff.

The hosted service determines which actions your account can use. Installing a command does not
add a missing backend action. Rooms requires server support and this session's verified identity.

[Host support](docs/SUPPORT.md) · [Migrate from CLI hooks](docs/migration/from-cli.md)

For development: `npm test`, `npm run build`, `npm run check`. Generated packages contain their
own runner and keep writable state outside installed files in `~/.estelle-plugins`.
