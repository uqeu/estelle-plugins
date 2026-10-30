import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, open, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpointSession, readTranscriptMessages, CHECKPOINT_LIMITS as L } from '../runtime/checkpoint.mjs';

const line = record => JSON.stringify(record) + '\n';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'estelle-checkpoint-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'fixture.jsonl');
  const calls = [];
  const options = { host: 'claude', repo: 'fixture/repo', stateDir: join(dir, 'state'),
    payload: { session_id: 'fixture-session', transcript_path: path, hook_event_name: 'Stop', cwd: '/fixture' },
    request: async (route, body) => { calls.push({ route, body }); } };
  return { path, dir, calls, options };
}
const message = (type, content, extra = {}) => ({ type, message: { role: type, content }, ...extra });

test('checkpoint transports redacted real conversation and tool marker, omitting raw results and reasoning', async t => {
  const f = await fixture(t);
  await writeFile(f.path, line(message('user', 'fix estelle_live_abcdefgh1234')) + line(message('assistant', [
    { type: 'text', text: 'working' }, { type: 'tool_use', name: 'Bash', input: { command: 'private command' } },
    { type: 'thinking', thinking: 'private reasoning' }, { type: 'tool_result', content: 'private result' },
  ])));
  const result = await checkpointSession(f.options);
  assert.equal(result.saved, true);
  assert.equal(result.messages, 2);
  assert.equal(f.calls[0].route, '/checkpoint');
  assert.equal(f.calls[0].body.session_id, 'fixture-session');
  assert.equal(f.calls[0].body.client.name, 'claude-code');
  const wire = JSON.stringify(f.calls[0].body);
  assert.match(wire, /redacted estelle key/);
  assert.match(wire, /tool: Bash/);
  for (const omitted of ['estelle_live_abcdefgh1234', 'private command', 'private reasoning', 'private result']) assert.ok(!wire.includes(omitted));
});

test('Codex response_item conversation is captured once, with latest branch provenance', async t => {
  const f = await fixture(t);
  await writeFile(f.path, [
    { type: 'session_meta', payload: { cwd: '/fixture', git: { branch: 'first' }, cli_version: '0.166.0' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'hello' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'world' }] } },
    { type: 'session_meta', payload: { git: { branch: 'latest' } } },
  ].map(line).join(''));
  const result = await readTranscriptMessages({ path: f.path, host: 'codex' });
  assert.deepEqual(result.messages.map(m => m.content), ['hello', 'world']);
  assert.equal(result.client.branch, 'latest');
  assert.equal(result.client.client_version, '0.166.0');
  assert.equal(result.client.transcript_partial, false);
});

test('message cap retains latest conversation and discloses loss in content and metadata', async t => {
  const f = await fixture(t);
  await writeFile(f.path, Array.from({ length: L.messages + 5 }, (_, i) => line(message('user', `turn-${i}`))).join(''));
  const result = await readTranscriptMessages({ path: f.path, host: 'claude' });
  assert.equal(result.messages.length, L.messages);
  assert.equal(result.client.turns_dropped, 5);
  assert.equal(result.client.transcript_partial, true);
  assert.match(result.messages[0].content, /checkpoint is PARTIAL/);
  assert.match(result.messages[0].content, /turn-5/);
  assert.equal(result.messages.at(-1).content, 'turn-404');
});

test('bounded head and tail of sparse large file disclose omitted middle', async t => {
  const f = await fixture(t);
  const file = await open(f.path, 'w');
  const head = line(message('user', 'oldest'));
  const tail = '\n' + line(message('assistant', 'newest'));
  await file.write(head, 0);
  await file.write(tail, L.tailBytes + L.headBytes + 1000);
  await file.close();
  const result = await readTranscriptMessages({ path: f.path, host: 'claude' });
  assert.equal(result.client.transcript_partial, true);
  assert.equal(result.client.transcript_read_bytes, L.tailBytes + L.headBytes);
  assert.match(result.messages[0].content, /oldest/);
  assert.equal(result.messages.at(-1).content, 'newest');
});

test('SubagentStop captures actual child transcript, keeps raw parent identity, adds attribution', async t => {
  const f = await fixture(t);
  const child = join(f.dir, 'child.jsonl');
  await writeFile(f.path, line(message('user', 'parent-only')));
  await writeFile(child, line(message('assistant', 'child work', { isSidechain: true })));
  Object.assign(f.options.payload, { hook_event_name: 'SubagentStop', agent_transcript_path: child, agent_id: 'agent-1', agent_type: 'Explore' });
  await checkpointSession(f.options);
  assert.equal(f.calls[0].body.session_id, 'fixture-session');
  assert.match(f.calls[0].body.messages[0].content, /^\[subagent: Explore agent-1\] child work$/);
  assert.ok(!JSON.stringify(f.calls).includes('parent-only'));
});

test('SessionEnd defers without opening transcript or calling network', async t => {
  const f = await fixture(t);
  f.options.payload.hook_event_name = 'SessionEnd';
  f.options.payload.transcript_path = '/nonexistent/not-opened';
  assert.deepEqual(await checkpointSession(f.options), { saved: false, deferred: true });
  assert.equal(f.calls.length, 0);
});

test('missing or unrecognized history is reported rather than claimed saved', async t => {
  const f = await fixture(t);
  await writeFile(f.path, line({ irrelevant: 'fixture' }));
  assert.equal((await checkpointSession(f.options)).saved, false);
  f.options.payload.transcript_path = null;
  assert.equal((await checkpointSession(f.options)).reason, 'host did not supply a transcript path');
  assert.equal(f.calls.length, 0);
});

test('Kimi legacy wire conversation is marked partial rather than claiming new persistence compatibility', async t => {
  const f = await fixture(t);
  await writeFile(f.path, line({ type: 'context.append_message', time: 123, message: { role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [] } }));
  const result = await readTranscriptMessages({ path: f.path, host: 'kimi' });
  assert.equal(result.messages.length, 1);
  assert.equal(result.client.transcript_format, 'kimi-legacy-wire');
  assert.equal(result.client.newer_format_verified, false);
  assert.equal(result.client.transcript_partial, true);
});

test('failed HTTP checkpoint propagates so caller keeps deferred work rather than claiming success', async t => {
  const f = await fixture(t);
  await writeFile(f.path, line(message('user', 'fixture')));
  f.options.request = async () => { throw Object.assign(new Error('HTTP503'), { status: 503 }); };
  await assert.rejects(checkpointSession(f.options), /HTTP503/);
});

test('leading and trailing blank records are not counted as messages or replayed backwards', async t => {
  const f = await fixture(t);
  await writeFile(f.path, '\n\n' + line(message('user', 'one')) + '\n\n');
  const result = await readTranscriptMessages({ path: f.path, host: 'claude' });
  assert.deepEqual(result.messages, [{ role: 'user', content: 'one' }]);
  assert.equal(result.client.lines, 1);
});
