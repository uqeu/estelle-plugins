# Verification

The test suite covers native host payloads/output, transcript capture and limits, redaction, retry
acknowledgements, reindex batching, path boundaries and the assembled hook runner.

Mutation controls proved the tests fail when context injection uses the wrong host field, a cursor
advances before server acknowledgement, the total request deadline is removed, credential redaction
is removed, active Kimi branch selection is bypassed, or cross-worktree throttling is weakened.

Native checks on 30 October 2026:

- Claude Code accepted the generated plugin with `claude plugin validate`. Its directory checks
  warned that no listing icon or privacy-policy metadata was supplied.
- Codex 0.166.0 installed the plugin in an isolated configuration. `codex plugin list` read back
  `estelle@estelle-plugins`, version `0.0.1`, installed and enabled.
- Kimi Code 2.3.0 installed the root package in an isolated configuration without a model login.
  `/plugins info estelle` read back enabled, state `ok`, its startup skill and one MCP server.
- Grok Build 1.0.41 accepted the generated native package inventory. An invalid-name control was
  refused. Installed-version source parity beyond the checked contract is not asserted.

No native model was invoked for these installation checks. They prove packaging and registration,
not authenticated MCP calls or a coding-quality improvement. The current probe process has no
usable Estelle API key; its authenticated remote hook/MCP probe has not passed. Run
`node scripts/probe.mjs` with `ESTELLE_API_KEY`, or explicitly use `--existing-login` when a private
legacy key is available. It checks read-only MCP initialization/catalogue and invalid-key refusal.

The existing Estelle connector in this development session is separate evidence. Its working tools
must not be used to claim that the new package's native HTTP authentication has been exercised.

Public package releases do not deploy the private backend. Server compatibility changes require
their own review, deployment and positive/negative production probes.
