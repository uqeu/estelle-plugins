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
Install or update Estelle for Claude Code from https://github.com/uqeu/estelle-plugins using plugins/claude. Follow docs/install/claude.md and docs/migration/from-cli.md. Preserve unrelated settings and active sessions; remove only verified legacy Estelle hook/MCP registrations. Never request or display credentials. Use native approval and a fresh session. Verify authentication with one advertised read-only MCP tool, then report package, MCP and hooks separately, with any pending step.
```

</details>

<details>
<summary>Codex</summary>

```text
Install or update Estelle for Codex from https://github.com/uqeu/estelle-plugins using plugins/codex. Follow docs/install/codex.md and docs/migration/from-cli.md. Preserve unrelated settings and active sessions; remove only verified legacy Estelle hook/MCP registrations. Never request or display credentials. Use native approval and a fresh session. Verify authentication with one advertised read-only MCP tool, then report package, MCP and hooks separately, with any pending step.
```

</details>

<details>
<summary>Kimi Code</summary>

```text
Install or update Estelle for Kimi Code from https://github.com/uqeu/estelle-plugins using plugins/kimi. Run the native install from this clone, including when reinstalling the same version. Follow docs/install/kimi.md and docs/migration/from-cli.md. Preserve unrelated settings and active sessions; remove only verified legacy Estelle hook/MCP registrations. Never request or display credentials. Use native approval and a fresh session. Verify authentication with one advertised read-only MCP tool, then report package, MCP and hooks separately, with any pending step. Never run kimi -p '/plugins …' or spawn nested model installation tests. If you cannot operate the interactive TUI, prepare/check the clone and give me one exact /plugins install command with its absolute path; report native installation pending.
```

</details>

<details>
<summary>Grok Build</summary>

```text
Install or update Estelle for Grok Build from https://github.com/uqeu/estelle-plugins using plugins/grok. Follow docs/install/grok.md and docs/migration/from-cli.md. Preserve unrelated settings and active sessions; remove only verified legacy Estelle hook/MCP registrations. Never request or display credentials. Use native approval and a fresh session. Verify authentication with one advertised read-only MCP tool, then report package, MCP and hooks separately, with any pending step.
```

</details>

<details>
<summary>Cursor</summary>

```text
Install or update Estelle for Cursor from https://github.com/uqeu/estelle-plugins using plugins/cursor. Follow docs/install/cursor.md and docs/migration/from-cli.md. Preserve unrelated settings and active sessions; remove only verified legacy Estelle hook/MCP registrations. Never request or display credentials. Use native approval and a fresh session. Verify authentication with one advertised read-only MCP tool, then report package, MCP and hooks separately, with any pending step.
```

</details>

Includes MCP connections, coding skills, recall hooks and local credential-pattern protection.
Successful empty recall adds no context. Hook execution alone does not establish MCP authentication.
All five hosts support bounded conversation capture. The Grok and Cursor transcript dialects are
inferred from the hook payload contract, not yet verified against a live host session, so their
captures disclose `format_verified: false` and must not be described as a complete handoff.

The hosted service determines which actions your account can use. Installing a command does not
add a missing backend action. Rooms requires server support and this session's verified identity.

[Host support](docs/SUPPORT.md) · [Migrate from CLI hooks](docs/migration/from-cli.md)

For development: `npm test`, `npm run build`, `npm run check`. Generated packages contain their
own runner and keep writable state outside installed files in `~/.estelle-plugins`.
