# From the CLI plugin

Install the host-specific package linked in the README. Plugin versions are independent of CLI
versions; the hosted service and your account's saved memory stay in place.

1. Ensure the host inherits `ESTELLE_API_KEY`. MCP and hooks must use the same account.
2. Disable or uninstall the old `estelle@fatelabs` plugin through the host's plugin manager.
3. If you used `estelle install-hooks`, inspect user/project hook settings as well. Remove only
   old Estelle entries invoking `npx ... @fatelabs/estelle ... estelle hook` or the Estelle binary.
   Preserve unrelated hooks and keep a local backup before changing configuration. Do not edit
   installed plugin caches, trust fingerprints or another active session's configuration.
4. Install the replacement, review native trust prompts and restart in a fresh session.
5. Check the installed package, MCP authentication, hook status and capture separately. An enabled
   plugin does not prove a successful authenticated upload or a complete Rooms handoff.

Existing CLI users may run `node scripts/launch.mjs <claude|codex|kimi|grok>` from a clone. It reads
one existing private `~/.estelle/auth.json` credential and passes it to the child environment
without printing it or invoking the CLI. For Cursor, start the application with the same
`ESTELLE_API_KEY` available to its process. Do not put its value in a shared plugin variable.

Version 0.0.1 used a combined package. Update Claude/Codex through the refreshed marketplace;
reinstall Kimi from `plugins/kimi`. Each current package contains only its host's manifest.
Project `AGENTS.md` and `CLAUDE.md` are not overwritten.

Changing an installed bundle invalidates Codex hook approval. Use `/hooks` to review the intended
replacement and press `t` to trust it; space only toggles enablement. Teardown saves are deferred
and do not count as acknowledged remote checkpoints.
