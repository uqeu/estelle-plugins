import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const KEY = 'synthetic-probe-fixture';
const BASE = 'https://fixture.invalid';
const MESSAGES = { '/session/events': 'session_id must be 1-256 characters',
  '/checkpoint': "checkpoint needs a 'session_id' (string)" };
const envelope = path => ({ error: { code: 400, message: MESSAGES[path] } });
const helper = async () => (await import('../scripts/probe-write-refusal.mjs')).refusedWrite;
const options = (path, fetchImpl) => ({ base: BASE, path, credential: KEY, fetchImpl });

function actualProbe(status, path = '/session/events') {
  const script = pathToFileURL(resolve(import.meta.dirname, '../scripts/probe.mjs')).href;
  const fixture = `
    const calls = [];
    globalThis.fetch = async (url, options) => {
      const route = new URL(url).pathname;
      const body = JSON.parse(options.body);
      calls.push({ route, method: body.method || null });
      if (route !== '/mcp') return Response.json({ error: { code: 400, message: ${JSON.stringify(MESSAGES)}[route] } },
        { status: route === ${JSON.stringify(path)} ? ${status} : 400 });
      if (options.headers.Authorization !== 'Bearer ${KEY}') return Response.json({}, { status: 401 });
      if (body.method === 'notifications/initialized') return new Response(null, { status: 204 });
      const result = body.method === 'initialize'
        ? { serverInfo: { name: 'owned-fixture' }, protocolVersion: '2025-03-26' }
        : { tools: [{ name: 'estelle_resume' }, { name: 'estelle_room' }] };
      return Response.json({ jsonrpc: '2.0', id: body.id, result });
    };
    try { await import(${JSON.stringify(script)}); }
    finally { console.error('fixture_calls=' + JSON.stringify(calls)); }
  `;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', fixture], {
    env: { ESTELLE_API_KEY: KEY }, encoding: 'utf8', timeout: 5000, maxBuffer: 64_000,
  });
}

for (const path of Object.keys(MESSAGES)) {
  for (const status of [401, 403, 404, 429]) {
    test(`actual script rejects ${status} write refusal for ${path}`, () => {
      const result = actualProbe(status, path);
      assert.notEqual(result.status, 0, 'authentication/routing/admission failures cannot pass validation');
      assert.equal(result.error, undefined);
      const line = result.stderr.split('\n').find(line => line.startsWith('fixture_calls='));
      const calls = JSON.parse(line.slice('fixture_calls='.length));
      assert.equal(calls.filter(call => call.route === path).length, 1, 'one attempt only');
      assert.equal(calls.filter(call => call.method === 'initialize').length, 2, 'both MCP auth controls ran');
      assert.equal(calls.filter(call => call.method === 'tools/list').length, 1);
    });
  }
}

test('actual script preserves MCP setup and both exact 400 validation positives', () => {
  const result = actualProbe(400);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.authenticatedInitialize, 200);
  assert.equal(report.invalidCredential, 401);
  assert.deepEqual(report.writePathRefusedInvalid, { '/session/events': 400, '/checkpoint': 400 });
});

for (const path of Object.keys(MESSAGES)) {
  test(`exact validation and unchanged request shape for ${path}`, async () => {
    const calls = [];
    const request = await helper();
    const result = await request(options(path, async (url, init) => {
      calls.push({ url, init });
      return Response.json({ ...envelope(path), request_timings: { total_s: 0.01 } }, { status: 400 });
    }));
    assert.equal(result, 400);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, BASE + path);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, '{}');
    assert.deepEqual(calls[0].init.headers, { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
    assert.equal(calls[0].init.redirect, 'error');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });
}

for (const status of [200, 302, 401, 403, 404, 429, 500, 503]) {
  test(`helper rejects HTTP ${status} even with validation-shaped JSON`, async () => {
    let calls = 0;
    await assert.rejects((await helper())(options('/checkpoint', async () => {
      calls++; return Response.json(envelope('/checkpoint'), { status });
    })), { message: 'probe_write_validation' });
    assert.equal(calls, 1);
  });
}

for (const [name, body] of Object.entries({ wrong_message: { error: { code: 400, message: 'not found' } },
  string_code: { error: { code: '400', message: MESSAGES['/checkpoint'] } },
  wrong_code: { error: { code: 401, message: MESSAGES['/checkpoint'] } },
  no_error: {}, string_error: { error: MESSAGES['/checkpoint'] }, null_json: null })) {
  test(`rejects malformed validation envelope ${name}`, async () => {
    await assert.rejects((await helper())(options('/checkpoint', async () => Response.json(body, { status: 400 }))),
      { message: 'probe_write_validation' });
  });
}

for (const text of ['', '{invalid-response']) {
  test(`rejects invalid JSON body length ${text.length} without echoing body`, async () => {
    await assert.rejects((await helper())(options('/checkpoint', async () => new Response(text, { status: 400 }))),
      { message: 'probe_write_response_json' });
  });
}

test('2MB boundary accepts complete JSON and refuses cap+1 without arrayBuffer', async () => {
  const request = await helper();
  const raw = JSON.stringify(envelope('/checkpoint'));
  const exact = raw + ' '.repeat(2_000_000 - Buffer.byteLength(raw));
  assert.equal(await request(options('/checkpoint', async () => new Response(exact, { status: 400 }))), 400);
  let closed = 0;
  const overflow = { status: 400, body: (async function* () {
    try { yield Buffer.from(exact); yield Buffer.from(' '); }
    finally { closed++; }
  })(), arrayBuffer() { throw new Error('unbounded_reader_forbidden'); } };
  await assert.rejects(request(options('/checkpoint', async () => overflow)), { message: 'probe_response_bound' });
  assert.equal(closed, 1, 'overflow closes the stream');
});

test('body read and fetch errors remain failures with closed diagnostics and no retry', async () => {
  const request = await helper();
  let calls = 0;
  await assert.rejects(request(options('/checkpoint', async () => {
    calls++;
    return { status: 400, body: (async function* () { yield Buffer.from('{'); throw new Error('raw-private-body'); })() };
  })), { message: 'probe_write_response_read' });
  assert.equal(calls, 1);
  await assert.rejects(request(options('/checkpoint', async () => { calls++; throw new Error('raw-private-transport'); })),
    { message: 'probe_write_transport' });
  assert.equal(calls, 2);
  await assert.rejects(request(options('/checkpoint', async () => ({ status: 400, body: null }))),
    { message: 'probe_write_response_json' });
});

test('unknown routes and missing or multiline credentials fail before dispatch', async () => {
  let calls = 0;
  const request = await helper();
  const fetchImpl = async () => { calls++; throw new Error('unexpected'); };
  for (const path of ['/other', '/checkpoint?x=1', 'constructor', '__proto__']) {
    await assert.rejects(request(options(path, fetchImpl)), { message: 'probe_write_route' });
  }
  for (const credential of ['', null, 'invalid\r\nheader']) {
    await assert.rejects(request({ ...options('/checkpoint', fetchImpl), credential }), { message: 'probe_write_credential' });
  }
  assert.equal(calls, 0);
});

test('owned loopback HTTP delivers synthetic header and streams genuine validation vs auth refusal', async t => {
  const seen = [];
  const listener = createServer(async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    seen.push({ path: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString() });
    res.writeHead(seen.length === 1 ? 400 : 401, { 'Content-Type': 'application/json' });
    res.write('{"error":');
    res.end(JSON.stringify(envelope('/checkpoint').error) + '}');
  });
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  t.after(() => { listener.closeAllConnections(); listener.close(); });
  const request = await helper();
  const input = { base: `http://127.0.0.1:${listener.address().port}`, path: '/checkpoint', credential: KEY };
  assert.equal(await request(input), 400);
  await assert.rejects(request(input), { message: 'probe_write_validation' });
  assert.deepEqual(seen, Array(2).fill({ path: '/checkpoint', authorization: `Bearer ${KEY}`, body: '{}' }));
});
