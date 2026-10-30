# Estelle plugins

Estelle integrations for Claude Code, Codex, Kimi Code and Grok Build. Hooks and skills share a
small Node.js runtime. They connect to the hosted MCP service at `https://api.fatelabs.ca/mcp`.

Requires Node.js 22 or later and `ESTELLE_API_KEY` in the agent's environment. Hooks and MCP use the
same key. No Estelle CLI installation is required. Version: `0.0.1`.

## Install

Claude Code:

```text
/plugin marketplace add uqeu/estelle-plugins
/plugin install estelle@estelle-plugins
```

Codex:

```sh
codex plugin marketplace add uqeu/estelle-plugins --ref main
codex plugin add estelle@estelle-plugins
```

Review the hooks in `/hooks` and approve the installed release. In Codex, `t` grants trust; space
toggles enablement. Start a new session after installation.

Kimi Code:

```text
/plugins install https://github.com/uqeu/estelle-plugins
/plugins info estelle
/reload
```

Grok Build:

```sh
grok plugin install uqeu/estelle-plugins@v0.0.1#plugins/grok
grok plugin enable estelle
```

## Included

- Native MCP connection declarations for all four hosts.
- Repository, memory, review, debugging and coding skills.
- Resume, Rooms, review, monitor, cloud and code commands on hosts with command support.
- Claude/Codex transcript streaming and bounded checkpoints, with upload retries.
- Kimi current/legacy wire capture and checkpoints from the active conversation branch.
- Batched reindexing of eligible edited source files.
- Local credential-pattern protection and Codex model-request observations.

Codex exposes plugin workflows as skills under the `estelle` namespace. The hosted server determines
which MCP tools your account can use. A command does not add a missing backend action.

Grok prompt hooks cannot inject context; recall is queued for its next supported tool boundary.
Grok transcript capture is not supported in this release. Kimi capture covers its registered main
agent; unsupported journal versions or context mutations are reported as incomplete.
Capture bounds, pending uploads and unavailable transcripts must not be called complete history.

## Diagnostics and development

Run development commands from a clone of this repository.

```sh
node runtime/cli.mjs doctor
npm test
npm run build
npm run check
```

Runtime state stays in `~/.estelle-plugins`, partitioned by credential. Nothing writes into installed
plugin bundles. Changing an installed bundle invalidates Codex hook approval; update through the host
and review the new release. The retired per-edit grounding gate is not installed.

Existing CLI users can use `node scripts/launch.mjs <claude|codex|kimi|grok>` from a clone of this repo
to start their agent with the existing stored Estelle key. The launcher never prints the key and does
not invoke the Estelle CLI. [Migration details](docs/migration/from-cli.md).

Source contracts and verification limits are recorded in [docs/research](docs/research).
