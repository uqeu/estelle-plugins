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
Set up Estelle for Codex from https://github.com/uqeu/estelle-plugins using plugins/codex. Read its README and docs/install/codex.md. Check this host’s installed version and current Estelle plugin/MCP/hook registrations first; do not change unrelated settings or an active session’s configuration. Use the native installation instructions above. Disable the old estelle@fatelabs plugin through the native manager. If old CLI-backed user/project hooks coexist, back up the affected config and remove only verified old Estelle rows while preserving other hooks. Do not edit plugin caches or trust fingerprints. Ensure hooks and MCP use the same ESTELLE_API_KEY in the host environment; never print its value or ask for it in chat. Use normal trust approval and restart in a fresh session. Report package installation, MCP registration, authenticated connection, hook execution, acknowledged uploads and Rooms support separately. Do not call an unavailable transcript or deferred save complete. Do not launch paid cloud/model work as an installation test.
```
