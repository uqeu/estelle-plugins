// Read-only remote MCP connection probe. No model calls, tool calls, or backend writes.
import assert from 'node:assert/strict';
import { apiBase } from '../runtime/io.mjs';
import { launchCredential } from '../runtime/auth.mjs';
import { VERSION } from '../runtime/version.mjs';

const MAX_BYTES = 2_000_000;
const key = process.argv.includes('--existing-login') ? await launchCredential() : process.env.ESTELLE_API_KEY;
if (!key) throw new Error('Set ESTELLE_API_KEY or explicitly use --existing-login. No credential was printed.');
const endpoint = `${apiBase()}/mcp`;
let session;
let version = '2025-03-26';
async function rpc(body, credential) {
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error',
    signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${credential}`,
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': version, ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(body) });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body || []) {
    bytes += chunk.byteLength;
    if (bytes > MAX_BYTES) throw new Error('probe_response_bound');
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let result;
  if (response.ok && raw.trim()) {
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
      result = data.find(item => item.id === body.id);
    } else result = JSON.parse(raw);
  }
  return { status: response.status, result, session: response.headers.get('mcp-session-id') };
}
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: version, capabilities: {}, clientInfo: { name: 'estelle-plugins-probe', version: VERSION } } };
const positive = await rpc(initialize, key);
assert.equal(positive.status, 200, 'Authenticated MCP initialize must succeed');
assert.ok(positive.result?.result?.serverInfo?.name, 'Server must return its own initialize result');
session = positive.session;
version = positive.result.result.protocolVersion;
const ready = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, key);
assert.ok([200, 202, 204].includes(ready.status));
const catalog = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, key);
assert.equal(catalog.status, 200);
const names = catalog.result?.result?.tools?.map(tool => tool.name);
assert.ok(Array.isArray(names) && names.length > 0, 'The server must return actual tools');
assert.ok(names.includes('estelle_resume') && names.includes('estelle_room'));
const negative = await rpc(initialize, 'invalid-synthetic-probe-credential');
assert.ok([401, 403].includes(negative.status), 'Invalid credential must be refused');
console.log(JSON.stringify({ endpoint, authenticatedInitialize: positive.status, toolCount: names.length,
  rooms: names.includes('estelle_room'), memory: names.includes('estelle_resume'),
  monitor: names.filter(name => name.startsWith('monitor_')).length,
  invalidCredential: negative.status, protocolVersion: version }, null, 2));
