# Kimi Code

Package: `plugins/kimi`. Requires Node.js 22 and `ESTELLE_API_KEY` in the host environment.

In a terminal, prepare the local package:

```sh
git clone https://github.com/uqeu/estelle-plugins.git
```

Inside the **interactive Kimi TUI**, use the clone's absolute path:

```text
/plugins install /absolute/path/to/estelle-plugins/plugins/kimi
/plugins info estelle
/reload
```

The native installer copies the local package; reinstall after updating the clone. `/reload` or
`/new` applies plugin changes to a session. Check the installed version and diagnostics with
`/plugins info estelle`, then check MCP authentication and actual hook execution separately.
Installing the package alone does not run its hooks.

**Do not run `kimi -p '/plugins install …'`.** `-p` sends a model prompt in non-interactive mode;
it does not open the TUI command handler. If an installer agent cannot operate the interactive
TUI, it should prepare and check the package, then give you one exact `/plugins install` command
with the resolved absolute path. Report that native installation is still pending. Do not launch
nested model turns, repeat research, or claim success from a prepared clone.

[Native plugin commands and reload behavior](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html)
· [`kimi -p` contract](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html).

[Migrate old CLI hooks](../migration/from-cli.md). The hosted backend controls permissions and tools.

## Copy/paste setup prompt

```text
Install or update Estelle for Kimi Code from https://github.com/uqeu/estelle-plugins using plugins/kimi. Run the native install from this clone, including when reinstalling the same version. Follow docs/install/kimi.md and docs/migration/from-cli.md. Use native approval and a fresh session; preserve unrelated settings and active sessions. Remove only verified legacy Estelle hook/MCP registrations after the replacement authenticates. Keep hooks and MCP on the same environment key; never request or display credentials. Verify authentication with one advertised read-only MCP tool, then report package, MCP and hooks separately, with any pending step. Never run kimi -p '/plugins …' or spawn nested model turns as installation tests. If interactive TUI access is unavailable, prepare/check the local package and give me one exact /plugins install command with its absolute path; report installation pending.
```
