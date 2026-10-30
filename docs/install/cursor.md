# Cursor

Package: `plugins/cursor`. Requires Node.js 22 and `ESTELLE_API_KEY` in the host environment.

```text
In Cursor Agent Chat, enter /add-plugin and add:
https://github.com/uqeu/estelle-plugins
Select Estelle from this repository’s Cursor marketplace.
```

Install through Cursor’s editor. Ensure its process inherits `ESTELLE_API_KEY`; do not paste the key into a shared plugin variable. Customize → Hooks and MCP show status. A terminal executable named `agent` is not proof that Cursor is installed.

[Migrate old CLI hooks](../migration/from-cli.md). The hosted backend controls permissions and tools.

## Copy/paste setup prompt

```text
Set up Estelle for Cursor from https://github.com/uqeu/estelle-plugins using plugins/cursor. Read its README and docs/install/cursor.md. Check this host’s installed version and current Estelle plugin/MCP/hook registrations first; do not change unrelated settings or an active session’s configuration. Use the native installation instructions above. Disable the old estelle@fatelabs plugin through the native manager. If old CLI-backed user/project hooks coexist, back up the affected config and remove only verified old Estelle rows while preserving other hooks. Do not edit plugin caches or trust fingerprints. Ensure hooks and MCP use the same ESTELLE_API_KEY in the host environment; never print its value or ask for it in chat. Use normal trust approval and restart in a fresh session. Report package installation, MCP registration, authenticated connection, hook execution, acknowledged uploads and Rooms support separately. Do not call an unavailable transcript or deferred save complete. Do not launch paid cloud/model work as an installation test.
```
