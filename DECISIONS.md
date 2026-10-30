# Integration extraction

Confirmed by Khai, 30 October 2026:

- Public repository: `uqeu/estelle-plugins`.
- Independent initial release: `0.0.1`.
- Claude Code, Codex, Kimi Code and Grok Build use native plugin mechanisms and a shared Node runtime.
- No full Rust CLI installation, download or build is required.
- MCP connection setup belongs here. Hosted backend code stays private in the existing repository at `https://api.fatelabs.ca/mcp`.
- Preserve existing integration capabilities where the host supports them; report actual capture or control limits.
- Retire automatic per-edit grounding gates; retain local credential-pattern protection.
- Audit skills and commands, and give old CLI users a migration path.
- Study Ponytail packaging and useful coding discipline without importing benchmark claims or blindly duplicating prompts.
- Estelle Cloud prompt work is a separate private implementation and evaluation task.

## Observed integration coupling

The installed plugin cache at `~/.codex/plugins/cache/fatelabs/estelle/0.4.7` declares 16 hook handlers. Its commands run `npx -y --package=@fatelabs/estelle@latest -- estelle hook …`, which couples hook delivery to the CLI package. The desired new distribution must replace that dependency, not merely copy its manifest into another repository.

Kimi Code’s official plugin documentation supports packaged skills, session instructions, MCP declarations and lifecycle hooks. Its hook and tool payloads still need a real Estelle adapter and parity tests; matching event names alone does not establish compatibility.

References: https://github.com/MoonshotAI/kimi-code · https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/plugins.md · https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/hooks.md
