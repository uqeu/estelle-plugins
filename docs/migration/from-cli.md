# From the CLI plugin

The new package is `estelle@estelle-plugins` from `uqeu/estelle-plugins`, version `0.0.1`.
Its version is independent of the old CLI package and plugin version. The hosted service stays at
`https://api.fatelabs.ca/mcp`; saved memory stays with the existing account.

1. Install the new package using the README instructions.
2. Ensure your agent inherits `ESTELLE_API_KEY`. The MCP connection and hooks must use the same account.
   Existing CLI users can start the agent with `node scripts/launch.mjs codex` (or `claude`, `kimi`,
   `grok`). This reads the single existing private `~/.estelle/auth.json` credential and passes it only
   to the child process environment. You can instead supply a dashboard API key in the environment.
3. Disable or uninstall the old `estelle@fatelabs` plugin through the host. If you previously ran
   `estelle install-hooks`, inspect user-level hook settings too: those can coexist with plugin hooks.
   Remove only entries invoking `npx ... @fatelabs/estelle ... estelle hook` or the Estelle binary;
   leave other plugins alone. This package does not rewrite shared host settings automatically.
4. Review and approve the replacement hooks, then start a new session. Check MCP and run `doctor`.

The new package does not require uninstalling the standalone CLI. The old distribution remains
available during migration. Avoid running both sets of Estelle hooks: that duplicates work.

Native plugins supply their instructions and skills at the host's supported boundaries. This package
does not silently overwrite project `AGENTS.md`, `CLAUDE.md` or other standing instructions.

Changing files in an installed plugin is not an update mechanism. In Codex, `/hooks` shows approval
changes; `t` trusts reviewed hooks. SessionEnd is synchronous and capped at three seconds there.
This package writes a local exit reference and retries uploads on a later session; a deferred save is
not a completed remote checkpoint.
