# Grok Build

Package: `plugins/grok`. Requires Node.js 22 and `ESTELLE_API_KEY` in the host environment.

```sh
grok plugin install uqeu/estelle-plugins@v0.0.2#plugins/grok
grok plugin enable estelle
```

Review the host’s normal installation and hook trust prompts, then start a fresh session.

[Migrate old CLI hooks](../migration/from-cli.md). The hosted backend controls permissions and tools.

## Copy/paste setup prompt

```text
Set up Estelle for Grok Build from https://github.com/uqeu/estelle-plugins using plugins/grok. Read its README and docs/install/grok.md. Check this host’s installed version and current Estelle plugin/MCP/hook registrations first; do not change unrelated settings or an active session’s configuration. Use the native installation instructions above. Disable the old estelle@fatelabs plugin through the native manager. If old CLI-backed user/project hooks coexist, back up the affected config and remove only verified old Estelle rows while preserving other hooks. Do not edit plugin caches or trust fingerprints. Ensure hooks and MCP use the same ESTELLE_API_KEY in the host environment; never print its value or ask for it in chat. Use normal trust approval and restart in a fresh session. Report package installation, MCP registration, authenticated connection, hook execution, acknowledged uploads and Rooms support separately. Do not call an unavailable transcript or deferred save complete. Do not launch paid cloud/model work as an installation test.
```
