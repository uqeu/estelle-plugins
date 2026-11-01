import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import test from 'node:test';
import { apiBase, apiClient, errorCode, stateDirectory } from '../runtime/io.mjs';
import { streamSession } from '../runtime/stream.mjs';

const AT = '2026-10-30T12:00:00.000Z';
const ENV = { ESTELLE_API_KEY: 'synthetic-test-credential' };
const message = (uuid, role, text) => ({ uuid, type: role, timestamp: AT,
  message: { role, content: [{ type: 'text', text }] } });

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'estelle-transport-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, stateDir: join(directory, 'state'), transcript: join(directory, 'transcript.jsonl') };
}

async function server(t, handle) {
  const requests = [];
  const listener = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ route: request.url, body, authorization: request.headers.authorization });
      await handle({ response, body, requests });
    } catch {
      if (!response.destroyed) response.writeHead(500).end('{}');
    }
  });
  listener.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { listener.once('listening', resolve); listener.once('error', reject); });
  t.after(() => { listener.closeAllConnections(); listener.close(); });
  return { url: `http://127.0.0.1:${listener.address().port}`, requests };
}

test('API URL permits HTTPS and literal loopback HTTP, rejecting credential-bearing or nonlocal HTTP URLs', () => {
  assert.equal(apiBase({}), 'https://api.fatelabs.ca');
  assert.equal(apiBase({ ESTELLE_API_URL: 'http://127.0.0.1:3210' }), 'http://127.0.0.1:3210');
  for (const url of ['http://example.invalid', 'https://user:secret@example.invalid',
    'https://example.invalid/?token=fixture', 'https://example.invalid/path', 'file:///tmp/file']) {
    assert.throws(() => apiBase({ ESTELLE_API_URL: url }), /invalid_api_url/);
  }
});

test('state paths reject approved bundle containment through direct paths and symlink aliases', async t => {
  const f = await fixture(t);
  const bundle = await realpath(resolve(import.meta.dirname, '..'));
  const alias = join(f.directory, 'bundle-alias');
  await symlink(bundle, alias);
  for (const target of [bundle, join(bundle, 'state'), alias, join(alias, 'new-state', 'child')]) {
    assert.throws(() => stateDirectory({ ESTELLE_PLUGIN_DATA: target }), /state_inside_bundle/);
  }
  assert.throws(() => stateDirectory({ ESTELLE_PLUGIN_DATA: join(alias, ...Array(70).fill('missing')) }),
    /state_inside_bundle|state_path_bound/, 'exhausting parent resolution cannot admit an unchecked bundle alias');
  assert.ok(stateDirectory({ ESTELLE_PLUGIN_DATA: join(f.directory, 'allowed-state') }).startsWith(f.directory));
});

test('credential partitions prevent replaying saved batches under a different account key', async t => {
  const f = await fixture(t);
  const base = { ESTELLE_PLUGIN_DATA: join(f.directory, 'allowed-state') };
  const first = stateDirectory({ ...base, ESTELLE_API_KEY: 'fixture-account-one' });
  const aliasOnly = stateDirectory({ ...base, ESTELLE_KEY: 'fixture-account-one' });
  const other = stateDirectory({ ...base, ESTELLE_API_KEY: 'fixture-account-two' });
  const anonymous = stateDirectory(base);
  assert.equal(aliasOnly, anonymous, 'only the launcher normalizes a legacy alias; runtime and native MCP require the same canonical variable');
  assert.notEqual(first, other);
  assert.notEqual(first, anonymous);
  assert.match(basename(first), /^[a-f0-9]{24}$/);
  assert.equal(first.includes('fixture-account-one'), false);
  assert.equal(basename(anonymous), 'unauthenticated');
});

test('CLI invalid state override fails open without writing into the bundle or producing a hook failure exit', async t => {
  const f = await fixture(t);
  const bundle = await realpath(resolve(import.meta.dirname, '..'));
  const env = { ...process.env, HOME: f.directory, USERPROFILE: f.directory, ESTELLE_PLUGIN_DATA: bundle };
  delete env.ESTELLE_API_KEY;
  delete env.ESTELLE_KEY;
  const before = (await readdir(bundle)).sort();
  const result = spawnSync(process.execPath, [join(bundle, 'runtime', 'cli.mjs'), 'hook', 'claude-code'], {
    env, input: JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'invalid-state-fixture', cwd: f.directory,
      transcript_path: null }), encoding: 'utf8', timeout: 3000,
  });
  assert.equal(result.status, 0, 'invalid plugin state must not abort the user turn');
  assert.equal(result.stdout, '');
  assert.deepEqual((await readdir(bundle)).sort(), before);
  const safeDirectory = stateDirectory({ HOME: f.directory, ESTELLE_PLUGIN_DATA: join(f.directory, '.estelle-plugins') });
  const status = JSON.parse(await readFile(join(safeDirectory, 'status', 'claude-code-runner.json'), 'utf8'));
  assert.equal(status.status, 'failed', 'failure must remain diagnosable rather than reported successful');
});

test('missing credentials and unsafe routes fail before fetch while valid request sends a bounded JSON body', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response('{"recall":"fixture"}', { status: 200 });
  };
  await assert.rejects(apiClient({ env: {}, fetchImpl })('/search', {}), /credential_missing/);
  const request = apiClient({ env: ENV, fetchImpl });
  await assert.rejects(request('/search?secret=fixture', {}), /invalid_route/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await request('/search', { query: 'ordinary text' }), { recall: 'fixture' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${ENV.ESTELLE_API_KEY}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { query: 'ordinary text' });
  assert.equal(calls[0].options.redirect, 'error');
});

test('real HTTP Estelle JSON error envelopes expose internal poison index without changing safe diagnostics', async t => {
  const local = await server(t, async ({ response }) => {
    response.writeHead(400, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: { message: 'event 1: fixture invalid event' } }));
  });
  const request = apiClient({ env: { ...ENV, ESTELLE_API_URL: local.url } });
  await assert.rejects(request('/session/events', { events: [] }), error => {
    assert.equal(error.status, 400);
    assert.equal(error.message, 'event 1: fixture invalid event');
    assert.equal(errorCode(error), 'http_400');
    return true;
  });
  assert.equal(local.requests.length, 1);
});

test('actual HTTP error parsing lets stream isolate one poison event and ACK the remaining transcript', async t => {
  const f = await fixture(t);
  await writeFile(f.transcript, [message('user-id', 'user', 'ordinary request'),
    message('assistant-id', 'assistant', 'ordinary answer')].map(JSON.stringify).join('\n') + '\n');
  const local = await server(t, async ({ response, requests }) => {
    response.writeHead(requests.length === 1 ? 400 : 200, { 'content-type': 'application/json' });
    response.end(requests.length === 1 ? JSON.stringify({ error: { message: 'event 1: fixture invalid event' } }) : '{}');
  });
  const request = apiClient({ env: { ...ENV, ESTELLE_API_URL: local.url } });
  const result = await streamSession({ stateDir: f.stateDir, host: 'claude-code', repo: 'fixture/repo', request,
    payload: { session_id: 'poison-fixture', hook_event_name: 'PostToolUse', transcript_path: f.transcript } });
  assert.equal(local.requests.length, 2);
  const first = local.requests[0].body.events;
  const second = local.requests[1].body.events;
  assert.equal(second.length, first.length - 1);
  assert.equal(second.some(item => item.event_id === first[1].event_id), false);
  assert.equal(second.some(item => item.event_id === first[0].event_id), true);
  assert.equal(result.dropped, 1);
  assert.equal(result.pending, undefined);
  assert.equal(result.offset, Buffer.byteLength(await readFile(f.transcript)));
});

test('one total API deadline bounds a slow spool backlog and preserves current unsent transcript', async t => {
  const f = await fixture(t);
  await writeFile(f.transcript, JSON.stringify(message('current-user', 'user', 'current-turn-survives')) + '\n');
  const spool = join(f.stateDir, 'spool');
  await mkdir(spool, { recursive: true });
  const BACKLOG = 12;
  for (let index = 0; index < BACKLOG; index++) {
    await writeFile(join(spool, `${String(index).padStart(2, '0')}.json`), JSON.stringify({
      session_id: `claude-code-old-${index}`, events: [{ event_id: `old-${index}`, kind: 'agent_message',
        author: { kind: 'agent', id: 'claude-code' }, at: AT, payload: { text: 'old queued message' } }],
    }));
  }
  const local = await server(t, async ({ response }) => {
    await new Promise(resolve => setTimeout(resolve, 80));
    if (!response.destroyed) response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  const start = Date.now();
  const request = apiClient({ env: { ...ENV, ESTELLE_API_URL: local.url }, timeoutMs: 1000, deadline: start + 220 });
  const result = await streamSession({ stateDir: f.stateDir, host: 'claude-code', repo: 'fixture/repo', request,
    payload: { session_id: 'deadline-fixture', hook_event_name: 'PostToolUse', transcript_path: f.transcript } });
  assert.ok(Date.now() - start < 750, 'the entire drain must stop before all twelve slow requests complete');
  assert.ok(local.requests.length > 0 && local.requests.length < BACKLOG, 'test must exercise real HTTP and leave a backlog');
  assert.equal(result.pending, true);
  const contents = await Promise.all((await readdir(spool)).map(name => readFile(join(spool, name), 'utf8')));
  assert.ok(contents.some(text => text.includes('current-turn-survives')), 'new capture must remain durable after the old backlog consumes the deadline');
  const state = JSON.parse(await readFile(join(f.stateDir, 'claude-code-deadline-fixture.stream.json'), 'utf8'));
  assert.equal(state.offset, 0, 'unacknowledged current transcript cannot advance');
});
