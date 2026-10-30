import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, appendFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamSession, mapClaude, mapCodex, mapKimi, safeSession, LIMITS } from '../runtime/stream.mjs';

const AT = '2026-10-30T12:00:00.000Z';
const claude = (uuid, type, content) => ({ uuid, timestamp: AT, type, message: { content } });
const rollout = payload => ({ timestamp: AT, type: 'response_item', payload });
const line = value => `${JSON.stringify(value)}\n`;

async function fixture(t, host = 'claude') {
  const dir = await mkdtemp(join(tmpdir(), 'estelle-stream-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const transcript = join(dir, 'fixture.jsonl');
  await writeFile(transcript, '');
  const calls = [];
  const options = { host, repo: 'fixture/repository', stateDir: join(dir, 'state'),
    payload: { session_id: 'fixture-session', transcript_path: transcript, hook_event_name: 'PostToolUse' },
    request: async (path, body) => { calls.push({ path, body }); return { accepted: body.events.length }; } };
  return { dir, transcript, calls, options, state: join(options.stateDir, `${host === 'claude' ? 'claude-code' : host}-fixture-session.stream.json`) };
}

test('Claude fixture maps actual messages, tools, edits, usage and ignores harness messages', () => {
  const notes = {};
  const user = mapClaude(claude('u1', 'user', 'Please fix this'), 0, notes);
  assert.equal(user[0].kind, 'customer_message');
  assert.equal(user[0].event_id, 'u1:0');
  assert.equal(user[1].payload.reason, 'input_received');
  assert.equal(notes.title, 'Please fix this');
  assert.deepEqual(mapClaude(claude('injected', 'user', '<system-reminder>instruction'), 0), []);
  const entry = claude('a1', 'assistant', [{ type: 'text', text: 'Working' }, { type: 'tool_use', id: 'call1', name: 'Write', input: { file_path: 'test.py', content: 'hello' } }]);
  entry.message.usage = { input_tokens: 10, output_tokens: 3 };
  const out = mapClaude(entry, 0);
  assert.equal(out[0].payload.usage.input, 10);
  assert.equal(out[1].kind, 'edit');
  assert.equal(out[1].payload.diff, '+hello');
  assert.equal(out[1].payload.call_id, 'call1');
});

test('Codex fixture uses rollout offsets, skips duplicate event messages and encrypted reasoning', () => {
  const out = mapCodex(rollout({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }), 123);
  assert.equal(out[0].event_id, 'r123:0');
  assert.equal(out[0].kind, 'customer_message');
  assert.deepEqual(mapCodex({ timestamp: AT, type: 'event_msg', payload: { type: 'user_message', message: 'hello' } }, 999), []);
  assert.deepEqual(mapCodex(rollout({ type: 'reasoning', encrypted_content: 'not-public' }), 999), []);
  assert.deepEqual(mapCodex(rollout({ type: 'message', role: 'developer', content: 'internal' }), 999), []);
  const result = mapCodex(rollout({ type: 'function_call_output', call_id: 'x', output: 'exit code zero' }), 234);
  assert.equal(result[0].payload.ok, null);
  assert.equal(result[0].payload.call_id, 'x');
});

test('successful stream ACK advances private durable cursor; second run sends no duplicates', async t => {
  const f = await fixture(t);
  await writeFile(f.transcript, line(claude('u', 'user', 'hello')) + line(claude('a', 'assistant', 'done')));
  const result = await streamSession(f.options);
  assert.equal(result.sent, 4);
  assert.equal(result.session_id, 'claude-code-fixture-session');
  assert.equal(f.calls[0].path, '/session/events');
  assert.equal(f.calls[0].body.events[0].payload.repo, 'fixture/repository');
  assert.equal(JSON.parse(await readFile(f.state, 'utf8')).offset, (await stat(f.transcript)).size);
  assert.equal((await stat(f.state)).mode & 0o777, 0o600);
  assert.equal((await streamSession(f.options)).sent, 0);
});

test('failed upload retains cursor and spools redacted batch; another session drains it', async t => {
  const f = await fixture(t);
  await writeFile(f.transcript, line(claude('u', 'user', 'fixture estelle_live_abcdefgh1234')));
  f.options.request = async () => { throw Object.assign(new Error('unavailable'), { status: 503 }); };
  const result = await streamSession(f.options);
  assert.equal(result.pending, true);
  assert.equal(JSON.parse(await readFile(f.state, 'utf8')).offset, 0);
  const spoolDir = join(f.options.stateDir, 'spool');
  const files = await readdir(spoolDir);
  assert.equal(files.length, 1);
  const spooled = await readFile(join(spoolDir, files[0]), 'utf8');
  assert.ok(!spooled.includes('estelle_live_abcdefgh1234'));
  assert.match(spooled, /redacted estelle key/);
  await rm(f.transcript);
  f.options.payload = { session_id: 'other-session' };
  f.options.request = async (path, body) => f.calls.push({ path, body });
  const drained = await streamSession(f.options);
  assert.equal(drained.replayed, 3);
  assert.equal((await readdir(spoolDir)).length, 0);
  assert.equal(f.calls[0].body.session_id, 'claude-code-fixture-session');
});

test('half-written last line is retained until newline arrives', async t => {
  const f = await fixture(t);
  const first = line(claude('u', 'user', 'hello'));
  const second = JSON.stringify(claude('a', 'assistant', 'done'));
  await writeFile(f.transcript, first + second);
  const result = await streamSession(f.options);
  assert.equal(result.offset, Buffer.byteLength(first));
  assert.equal(result.incomplete, true);
  await appendFile(f.transcript, '\n');
  const next = await streamSession(f.options);
  assert.equal(next.sent, 1);
  assert.equal(f.calls.at(-1).body.events[0].payload.text, 'done');
});

test('known poison event is isolated while other 400 refusals do not advance cursor', async t => {
  const f = await fixture(t);
  await writeFile(f.transcript, line(claude('u', 'user', 'hello')));
  let attempts = 0;
  f.options.request = async (path, body) => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error('event 1: invalid fixture'), { status: 400 });
    f.calls.push({ path, body });
  };
  const result = await streamSession(f.options);
  assert.equal(result.dropped, 1);
  assert.equal(result.sent, 2);
  assert.equal(f.calls[0].body.events.some(e => e.event_id === 'u:0'), false);
  await appendFile(f.transcript, line(claude('a', 'assistant', 'next')));
  const oldOffset = JSON.parse(await readFile(f.state, 'utf8')).offset;
  f.options.request = async () => { throw Object.assign(new Error('invalid entire request'), { status: 400 }); };
  assert.equal((await streamSession(f.options)).pending, true);
  assert.equal(JSON.parse(await readFile(f.state, 'utf8')).offset, oldOffset);
});

test('wire batches have an event bound and do not report finished ahead of backlog', async t => {
  const f = await fixture(t);
  await writeFile(f.transcript, Array.from({ length: 400 }, (_, i) => line(claude(`u${i}`, 'assistant', `message${i}`))).join(''));
  f.options.payload.hook_event_name = 'Stop';
  const result = await streamSession(f.options);
  assert.equal(result.incomplete, true);
  assert.ok(f.calls.every(call => call.body.events.length <= LIMITS.batchEvents));
  assert.ok(f.calls.flatMap(call => call.body.events).every(e => e.payload.reason !== 'input_required'));
  assert.equal((await streamSession(f.options)).incomplete, false);
});

test('invalid session identities fail before networking and unverified dialect is explicit', async t => {
  const f = await fixture(t);
  assert.equal(safeSession('../escape'), false);
  assert.equal(safeSession('valid_123-id'), true);
  f.options.payload.session_id = '../escape';
  await assert.rejects(streamSession(f.options), /invalid host session identity/);
  assert.equal(f.calls.length, 0);
  const result = await streamSession({ ...f.options, host: 'unverified-host' });
  assert.equal(result.unsupported, true);
});

test('Kimi legacy and current wire use recorded timestamps and IDs while unknown journal types remain unsupported', () => {
  const user = mapKimi({ type: 'context.append_message', time: Date.parse(AT), message: { role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [] } }, 12);
  assert.equal(user[0].event_id, 'r12:0');
  assert.equal(user[0].kind, 'customer_message');
  assert.equal(user[0].at, AT);
  const assistant = mapKimi({ type: 'context.append_message', time: Date.parse(AT), message: { role: 'assistant', content: [{ type: 'text', text: 'Working' }],
    toolCalls: [{ type: 'function', id: 'call1', name: 'Read', arguments: '{"path":"file.txt"}' }] } }, 24);
  assert.equal(assistant[1].kind, 'tool_call');
  assert.equal(assistant[1].payload.call_id, 'call1');
  assert.equal(assistant[1].author.id, 'kimi-code');
  assert.deepEqual(assistant[1].payload.input, { path: 'file.txt' });
  const current = mapKimi({ type: 'agent.message.appended', time: Date.parse(AT), message: { message: { role: 'user', content: [{ type: 'text', text: 'current format' }] } } }, 48);
  assert.equal(current[0].kind, 'customer_message');
  assert.equal(current[0].payload.text, 'current format');
  assert.deepEqual(mapKimi({ type: 'agent.future_message.appended', time: Date.parse(AT), message: { message: { role: 'user', content: [{ type: 'text', text: 'unverified future format' }] } } }, 48), []);
  assert.deepEqual(mapKimi({ type: 'context.append_message', time: 1e300 }, 50), []);
  assert.deepEqual(mapClaude(claude('invalid-blocks', 'assistant', [null, 'invalid']), 0), []);
});

test('corrupt state refuses to masquerade as a successful empty stream', async t => {
  const f = await fixture(t);
  await streamSession({ ...f.options, payload: { session_id: 'fixture-session' } });
  await writeFile(f.state, '{broken json');
  await assert.rejects(streamSession(f.options), /stream state is unreadable or invalid/);
  assert.equal(f.calls.length, 0);
});

test('Stop reports turn completion even if preceding tool hook already streamed its last reply', async t => {
  const f = await fixture(t);
  await writeFile(f.transcript, line(claude('u', 'user', 'hello')) + line(claude('a', 'assistant', 'done')));
  await streamSession(f.options);
  f.options.payload.hook_event_name = 'Stop';
  const stopped = await streamSession(f.options);
  assert.equal(stopped.sent, 1);
  assert.equal(f.calls.at(-1).body.events[0].payload.reason, 'input_required');
  assert.equal(f.calls.at(-1).body.events[0].at, AT);
  assert.equal((await streamSession(f.options)).sent, 0);
  f.options.payload.hook_event_name = 'UserPromptSubmit';
  assert.equal((await streamSession(f.options)).sent, 1);
  assert.equal(f.calls.at(-1).body.events[0].payload.reason, 'input_received');
});

test('an oversized complete line is counted and skipped; an oversized partial line retains cursor', async t => {
  const f = await fixture(t);
  await writeFile(f.transcript, 'x'.repeat(LIMITS.readBytes + 20) + '\n' + line(claude('u', 'user', 'next')));
  const first = await streamSession(f.options);
  assert.equal(first.skipped_lines, 1);
  assert.equal(first.incomplete, true);
  const second = await streamSession(f.options);
  assert.equal(second.sent, 3);
  assert.equal(f.calls[0].body.events[1].payload.text, 'next');
  await writeFile(f.transcript, 'x'.repeat(LIMITS.readBytes + 20));
  await rm(f.state);
  const partial = await streamSession(f.options);
  assert.match(partial.reason, /cursor retained/);
  assert.equal(partial.sent, 0);
});

test('a transcript entry exceeding block bound is refused explicitly before cursor movement', async t => {
  const f = await fixture(t);
  await writeFile(f.transcript, line(claude('a', 'assistant', Array.from({ length: LIMITS.messageBlocks + 1 }, () => ({ type: 'text', text: 'block' })))));
  await assert.rejects(streamSession(f.options), /message exceeds block bound; cursor retained/);
  assert.equal(f.calls.length, 0);
});
