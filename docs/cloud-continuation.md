# Native cloud preparation and import

## Prepare a new paused workspace

This path requires a server advertising inactive native staging. It supports selected Claude Code and
Codex files and the bounded Git tree described below. The source session must already belong to you and
be attached to the chosen Room. This command does not join a Room or change its sharing permissions.
Provider credentials must already be configured for your personal account; never pass them as arguments.

First validate without requesting a computer:

```sh
node runtime/cli.mjs prepare-cloud --harness codex --session UUID --transcript /absolute/path/to/the-selected-rollout-UUID.jsonl --repo /absolute/path/to/repo --room ROOM_ID --payment estelle --model RECORDED_MODEL --task "Continue the selected task" --launch-key NEW_UNIQUE_KEY --consent --replace
```

Choose the payment route explicitly: `estelle`, `provider_key`, or `subscription`. The server checks it
against the recorded native provider and model, your available credentials and Room permissions. A
subscription is personal; sharing work does not authorize a teammate to spend it.

To request the new computer, use `stage-cloud` with the same arguments and add `--provision-consent`.
This can spend compute credits. It validates again, provisions a new workspace, checks transferred files
and pauses it. It does not run a model or take over the laptop. `--replace` consents to writing the selected
files inside this new workspace; an existing workspace is not overwritten by this command.

The response remains `safe_to_close_laptop: false`. An incomplete response keeps the computer identity and
cleanup result when available. A lost response is never retried automatically: inspect your personal
cloud workspaces before another paid attempt. No full history, authentication, exclusive writer or
completed handover claim is made by staging.

## Import into an existing workspace

This requires the server's `restore_native` action. It does not provision a Silo or replace provider sign-in.

For an existing, idle Silo on the same repository commit:

```sh
node runtime/cli.mjs continue-cloud --harness codex --session UUID --transcript /absolute/path/to/the-selected-rollout-UUID.jsonl --repo /absolute/path/to/repo --silo SILO_ID --consent --replace
```

For Claude Code, use `--harness claude-code` and the selected `UUID.jsonl` under that user's `.claude/projects` directory. The command reads that file only. It never copies an authentication store or the whole home directory.

The source and Silo must use the same coding agent. Provider authentication is configured separately. A teammate's subscription is not authorized by sharing a Room.

This first import supports UTF-8 tracked files with unstaged changes and one conversation, up to 512 KiB combined, with at most 8,192 characters in one text field or selected file. It refuses staged changes, deletes, executable-file changes, untracked files, unsafe paths, private/encrypted reasoning blocks and larger artifacts. It never silently drops them or truncates a conversation. Kimi, Grok and Cursor native imports are not supported yet.

The server reads back transferred hashes before requesting a native resume. This proves file delivery, not that the model loaded the full context or that ownership has moved. The response therefore does not say it is safe to close the laptop. Keep the original session available until the cloud authentication, session and handover checks succeed.

To preserve staged/index state, deletions, executable modes and small binary files, add `--preserve-tree`. This first checks server protocol support before importing. Each selected blob is bounded at 8 KiB; the combined bound remains 512 KiB. List every non-ignored untracked file explicitly with repeated `--untracked path` flags. The client refuses an incomplete selection or an unsupported server.

Tree capture refuses assume-unchanged, skip-worktree, intent-to-add, sparse indexes and sparse checkouts. Bounded directory-name checks permit matching filenames on Mac filesystems but refuse unstaged case-only renames. It checks the full index metadata before reading selected contents and again before returning. File-mode observation overrides `core.fileMode` for each command and filesystem monitor/untracked cache shortcuts are disabled; user Git configuration is unchanged. This exports selected index and worktree bytes, not repository configuration.
