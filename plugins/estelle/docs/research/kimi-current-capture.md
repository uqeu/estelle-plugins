# Current Kimi conversation capture

Checked 30 October 2026 against MoonshotAI/kimi-code at
`a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55`. Installed Kimi reports 2.3.0;
the corresponding source tag is `b5e28fd6beac752a2cdcc0ff2f5fdf40e6494fbb`.
No real user configuration, transcript, credential or model call was used.

## Current format and the earlier coverage error

The serving `WireService` still writes each agent's `wire.jsonl`, including the
main agent at `<registered session>/agents/main/wire.jsonl`. Current engine
events use `agent.message.appended` and `agent.turn.ended`, not only the older
`context.append_message` vocabulary. The compatibility prefix
`human.agent.message.appended` is also recognized. The former legacy-only
mapper could find this file while omitting current conversation records.

A current message record contains a history entry in `record.message`; its
visible message is `record.message.message`, and metadata is beside it.
The normalizer supports that shape and the earlier direct-message shape.
It retains actual recorded timestamps and tool identifiers. It excludes
system injections, media bytes/URLs and reasoning, including encrypted content.
Known credential-shaped text is redacted before return.

Sources: [serving wire implementation](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/wire/wireService.ts),
[engine journal adapter](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/agent/loop/machine/storeJournal.ts),
[current journal vocabulary](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/wire/human.ts),
[actual engine fixtures](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/test/agent/loop/loop.test.ts).

## Branches and continuation

Kimi records undo and branch changes inside the same append-only journal through
`agent.switched`. Its `base.branch` and physical `base.line` determine the active
ancestry; raw journal history includes abandoned alternatives. `activeKimiRecords`
selects the same ancestry iteratively, with explicit limits and validation, so a
checkpoint does not silently combine abandoned and revised answers.

`readKimiHistory({sessionId,cwd,home})` reuses the existing exact registry resolver.
It reads only this registered session's main-agent wire file. The result contains
the source path, detected format, normalized active records, visible user/assistant
messages and a coverage object. It never writes Kimi state or walks other sessions.

The public source also contains a separate `human/persist` tree-store migration
implementation. Its presence is not evidence that the serving `WireService`
stopped writing wire files. This reader does not guess how to open an unrelated
`trees` directory if the registered wire is unavailable.

Sources: [wire branch selection](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/wire/tree/tree.ts),
[wire migration protocol 1.5](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/wire/migration/migration.ts),
[history schema](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/human/agent/historySchema.ts).

## Bounds and verification

Reads are capped at 32 MiB, 100,000 records and 256 branches. A future protocol,
invalid JSON, malformed ancestry, missing registry entry or exceeded read bound
returns unavailable with a reason; it does not certify an empty conversation.
A partial final line and unknown record/content types are disclosed as partial.
Standalone legacy undo/clear/compaction records without a verified branch
projection are refused for active continuation. Subagent histories are outside
this reader's declared main-agent scope.

Ten synthetic tests cover current nested records, compatibility aliases, visible
tool calls, reasoning exclusion, exact registry scope, active ancestry, future
versions, invalid records, partial tails, resource bounds and known credential
redaction. A deliberate mutation bypassing active ancestry makes the branch
regression fail. These are source-contract and reader checks; they do not prove
installation, live authenticated capture or improved coding quality.
