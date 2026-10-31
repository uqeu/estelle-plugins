# Replace a legacy installation

Install the host-specific package linked in the README. The hosted account and its saved memory
stay in place. Use the host's plugin/MCP/hook manager to identify existing registrations; do not
dump configuration files or credential stores into chat.

1. Make `ESTELLE_API_KEY` available to the host process. MCP and hooks use that same environment
   key. A separate MCP OAuth login does not authenticate the hooks. Never ask for a key in chat.
2. Install the replacement with native approval, then verify its authenticated MCP connection.
   Do not add a second standalone MCP server when the plugin already provides one.
3. Disable the old `estelle@fatelabs` plugin **if it is installed**, through the native manager.
   For user/project hooks, remove only rows verified to invoke the old Estelle CLI (`estelle hook`
   or `@fatelabs/estelle`). Back up the affected config and preserve other rows.
4. Check for a separate legacy MCP registration alongside the plugin's server. Verify its source
   and exact endpoint (`https://api.fatelabs.ca/mcp`) before disabling only that legacy row.
   A name containing “Estelle” is not sufficient evidence. Keep the plugin-owned server and all
   unrelated servers. Do not erase a credential to resolve a duplicate registration.
5. Reload through the host's supported action and start a fresh session. Do not modify an active
   session, plugin cache or hook trust fingerprint. Use normal trust prompts; in Codex `/hooks`,
   `t` grants trust while space only toggles enablement.

A healthy plugin server and a failed old server are separate registrations. Repair or remove the
verified old row; do not reconfigure the healthy plugin or create another server.

Report three short results, with the evidence observed and any next step:

- **Package:** installed version and native enabled/trust state.
- **MCP:** authenticated connection and actual tool discovery, or its specific failure.
- **Hooks:** the event actually observed and local status; say “not observed” until it runs.

An enabled package does not prove authentication or hook execution. Hook execution does not prove
an acknowledged upload. A deferred save is pending; missing transcripts and partial capture are
not complete history. Test Rooms only if requested and with this session's own proof. Do not start
paid model or cloud work to test installation. Keep the report concise; do not paste full tool
catalogues, environment dumps or transcript content.

Existing CLI users may run `node scripts/launch.mjs <claude|codex|kimi|grok>` from a clone. It reads
one existing private `~/.estelle/auth.json` credential and passes it to the child environment
without printing it or invoking the CLI. For Cursor, start the application with the same
`ESTELLE_API_KEY` available to its process; do not put it in a shared plugin variable.

Version 0.0.1 used a combined package. Update Claude/Codex through the refreshed marketplace;
reinstall Kimi from `plugins/kimi`. Project `AGENTS.md` and `CLAUDE.md` are not overwritten.
