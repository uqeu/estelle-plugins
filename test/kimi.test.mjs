import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalize, formatContext, getTranscriptPath } from '../adapters/kimi.mjs';

const base = { hook_event_name: 'UserPromptSubmit', session_id: 'test-session', cwd: '/project' };

test('Kimi native content-part prompts become text without image payloads', () => {
  const value = normalize({ ...base, prompt: [
    { type: 'text', text: 'first' }, { type: 'image_url', image_url: { url: 'private' } },
    { type: 'text', text: 'second' },
  ] });
  assert.equal(value.prompt, 'first\nsecond');
  assert.equal(value.host, 'kimi');
  assert.equal(value.sessionId, 'test-session');
  assert.equal(value.transcriptPath, undefined);
});

test('native file path is normalized while original arguments remain intact', () => {
  const input = { path: 'src/a.ts', new_string: 'new', old_string: 'old' };
  const value = normalize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: input });
  assert.equal(value.toolName, 'Edit');
  assert.equal(value.toolInput.file_path, 'src/a.ts');
  assert.equal(value.toolInput.path, 'src/a.ts');
  assert.equal(value.toolInput.new_string, 'new');
  assert.equal(input.file_path, undefined);
});

test('invalid native envelope and unbounded prompts are refused', () => {
  for (const value of [null, [], {}, { ...base, hook_event_name: 'BeforeThinking' },
    { ...base, session_id: '../other' }, { ...base, cwd: 'relative' },
    { ...base, prompt: 'x'.repeat(200_001) }, { ...base, prompt: Array(257).fill({ type: 'text', text: '' }) }]) {
    assert.throws(() => normalize(value));
  }
  assert.equal(normalize({ ...base, hook_event_name: 'SessionStart', source: 'resume' }).source, 'resume');
});

test('context uses native message field only on UserPromptSubmit', () => {
  assert.deepEqual(formatContext('repo context', 'UserPromptSubmit'), { message: 'repo context' });
  for (const event of ['SessionStart', 'SubagentStart', 'PreToolUse', 'PreCompact', 'Stop']) {
    assert.equal(formatContext('repo context', event), null);
  }
  assert.equal(formatContext('', 'UserPromptSubmit'), null);
  assert.throws(() => formatContext(undefined, 'UserPromptSubmit'));
});

async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'estelle-kimi-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const session = path.join(home, 'sessions', 'workspace', base.session_id);
  const wire = path.join(session, 'agents', 'main', 'wire.jsonl');
  await mkdir(path.dirname(wire), { recursive: true });
  await writeFile(wire, '{"type":"metadata"}\n');
  const entry = { sessionId: base.session_id, workDir: base.cwd, sessionDir: session };
  const registry = path.join(home, 'session_index.jsonl');
  await writeFile(registry, `${JSON.stringify(entry)}\n`);
  return { home, session, wire, entry, registry };
}

test('only exact registered session and cwd can resolve a legacy transcript', async t => {
  const data = await fixture(t);
  assert.equal(await getTranscriptPath(normalize(base), data), data.wire);
  assert.equal(await getTranscriptPath(normalize({ ...base, session_id: 'another' }), data), undefined);
  assert.equal(await getTranscriptPath(normalize({ ...base, cwd: '/other-project' }), data), undefined);
  assert.equal(normalize({ ...base, transcript_path: '/untrusted/file' }).transcriptPath, undefined);
});

test('missing and oversized registry are unavailable rather than history scans', async t => {
  const data = await fixture(t);
  await writeFile(data.registry, 'x'.repeat(2_000_001));
  assert.equal(await getTranscriptPath(normalize(base), data), undefined);
  await rm(data.registry);
  assert.equal(await getTranscriptPath(normalize(base), data), undefined);
});

test('outside, conflicting and symlinked registry entries cannot redirect capture', async t => {
  const data = await fixture(t);
  await writeFile(data.registry, `${JSON.stringify({ ...data.entry, sessionDir: tmpdir() })}\n`);
  assert.equal(await getTranscriptPath(normalize(base), data), undefined);
  await writeFile(data.registry, `${JSON.stringify(data.entry)}\n${JSON.stringify({ ...data.entry, sessionDir: tmpdir() })}\n`);
  assert.equal(await getTranscriptPath(normalize(base), data), undefined);
  await rm(data.registry);
  await symlink(path.join(data.session, 'agents', 'main', 'wire.jsonl'), data.registry);
  assert.equal(await getTranscriptPath(normalize(base), data), undefined);
});

test('new tree-only persistence never masquerades as a captured wire transcript', async t => {
  const data = await fixture(t);
  await rm(data.wire);
  await mkdir(path.join(data.session, 'trees', 'session'), { recursive: true });
  assert.equal(await getTranscriptPath(normalize(base), data), undefined);
});
