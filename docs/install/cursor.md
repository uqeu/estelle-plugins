# Cursor

Package: `plugins/cursor`. Requires Node.js 22 and `ESTELLE_API_KEY` in the host environment.

Use the editor's Customize page to install from an available marketplace. For a Git repository
not already available there, use a team marketplace import if your plan permits it, or Cursor's
[documented local plugin loading](https://cursor.com/docs/plugins#test-plugins-locally): copy the
contents of `plugins/cursor` into a new `~/.cursor/plugins/local/estelle` directory, then run
**Developer: Reload Window**. Review an existing installation before replacing it. Local imports
must be allowed; an installed marketplace plugin with the same name takes precedence.

Ensure the editor process inherits `ESTELLE_API_KEY`; do not paste the key into a shared plugin
variable. Check the plugin components, Hooks and MCP in Customize after reload. A terminal
executable named `agent` does not prove that the editor loaded this plugin. Native Cursor
authentication and hook execution still need to be observed in that editor before reporting them
as working. [Cursor's installation and management contract](https://cursor.com/docs/plugins).

[Migrate old CLI hooks](../migration/from-cli.md). The hosted backend controls permissions and tools.

## Copy/paste setup prompt

```text
Install or update Estelle for Cursor from https://github.com/uqeu/estelle-plugins using plugins/cursor. Follow docs/install/cursor.md and docs/migration/from-cli.md. Use native approval and a fresh session; preserve unrelated settings and active sessions. Remove only verified legacy Estelle hook/MCP registrations after the replacement authenticates. Keep hooks and MCP on the same environment key; never request or display credentials. Verify authentication with one advertised read-only MCP tool, then report package, MCP and hooks separately, with any pending step. No paid installation tests.
```
