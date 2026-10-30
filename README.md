# Estelle plugins

Estelle for Claude Code, Codex, Kimi Code, Grok Build and Cursor. Each host has its own package
under `plugins/`. They connect to `https://api.fatelabs.ca/mcp`.

Requires Node.js 22 or later and `ESTELLE_API_KEY` in the agent's environment. Hooks and MCP use
the same key. No Estelle CLI installation is needed. Version: `0.0.2`.

| Host | Install instructions and copy/paste setup prompt |
|---|---|
| Claude Code | [Claude](docs/install/claude.md) |
| Codex | [Codex](docs/install/codex.md) |
| Kimi Code | [Kimi](docs/install/kimi.md) |
| Grok Build | [Grok](docs/install/grok.md) |
| Cursor | [Cursor](docs/install/cursor.md) |

Includes MCP connections, coding skills, recall hooks and local credential-pattern protection.
Claude, Codex and Kimi also support bounded conversation capture. Grok and Cursor transcript
capture is unavailable; neither should be described as a complete handoff.

The hosted service determines which actions your account can use. Installing a command does not
add a missing backend action. Rooms requires server support and this session's verified identity.

[Host support](docs/SUPPORT.md) · [Migrate from CLI hooks](docs/migration/from-cli.md)

For development: `npm test`, `npm run build`, `npm run check`. Generated packages contain their
own runner and keep writable state outside installed files in `~/.estelle-plugins`.
