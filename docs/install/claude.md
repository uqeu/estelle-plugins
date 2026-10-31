# Claude Code

Package: `plugins/claude`. Requires Node.js 22 and `ESTELLE_API_KEY` in the host environment.

```text
/plugin marketplace add uqeu/estelle-plugins
/plugin install estelle@estelle-plugins
```

Review the host’s normal installation and hook trust prompts, then start a fresh session.

[Migrate old CLI hooks](../migration/from-cli.md). The hosted backend controls permissions and tools.

## Copy/paste setup prompt

```text
Install or update Estelle for Claude Code from https://github.com/uqeu/estelle-plugins using plugins/claude. Follow docs/install/claude.md and docs/migration/from-cli.md. Use native approval and a fresh session; preserve unrelated settings and active sessions. Remove only verified legacy Estelle hook/MCP registrations after the replacement authenticates. Keep hooks and MCP on the same environment key; never request or display credentials. Verify authentication with one advertised read-only MCP tool, then report package, MCP and hooks separately, with any pending step. No paid installation tests.
```
