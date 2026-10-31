# Codex

Package: `plugins/codex`. Requires Node.js 22 and `ESTELLE_API_KEY` in the host environment.

```sh
codex plugin marketplace add uqeu/estelle-plugins --ref main
codex plugin add estelle@estelle-plugins
codex plugin list
```

For an existing marketplace, run `codex plugin marketplace upgrade estelle-plugins` before reinstalling. Review `/hooks`; `t` grants trust and space only toggles enablement.

[Migrate old CLI hooks](../migration/from-cli.md). The hosted backend controls permissions and tools.

## Copy/paste setup prompt

```text
Install or update Estelle for Codex from https://github.com/uqeu/estelle-plugins using plugins/codex. Follow docs/install/codex.md and docs/migration/from-cli.md. Use native approval and a fresh session; preserve unrelated settings and active sessions. Remove only verified legacy Estelle hook/MCP registrations after the replacement authenticates. Keep hooks and MCP on the same environment key; never request or display credentials. Verify authentication with one advertised read-only MCP tool, then report package, MCP and hooks separately, with any pending step. No paid installation tests.
```
