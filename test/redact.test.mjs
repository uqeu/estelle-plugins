import test from 'node:test';
import assert from 'node:assert/strict';
import { cap, redact, sanitize, FIELD_CAP } from '../runtime/redact.mjs';
import { mapClaude } from '../runtime/stream.mjs';

test('known credential patterns are redacted while ordinary source survives', () => {
  const samples = [
    ['sk_live_abcdefgh1234', 'stripe'], ['estelle_live_abcdefgh1234', 'estelle'],
    ['ghp_abcdefghijklmnopqrstuvwxyz', 'github'], ['github_pat_abcdefghijklmnopqrstuvwxyz', 'github'],
    ['sk-proj-abcdefghijklmnopqrstuvwxyz', 'API'], ['xoxb-1234567890-abcdef', 'slack'],
    ['eyJabcdefghijklmnop.abcdefghijklmnop.abcdefghijklmnop', 'jwt'],
    ['-----BEGIN RSA PRIVATE KEY-----\nfixture\n-----END RSA PRIVATE KEY-----', 'private key'],
    ['postgres://user:fixturePassword@localhost/db', 'redacted'],
    ['AKIAABCDEFGHIJKLMNOP', 'aws'], ['API_KEY=abcdefghijklmno', 'redacted'],
    ['Bearer abcdefghijklmnop', 'redacted'],
  ];
  for (const [secret, label] of samples) {
    const clean = redact(`ordinary content ${secret} suffix`);
    assert.ok(!clean.includes(secret), label);
    assert.match(clean, /ordinary content/);
    assert.ok(clean.includes(label), clean);
  }
  assert.equal(redact('function example() { return 42; }'), 'function example() { return 42; }');
});

test('nested sensitive values and NUL object keys are scrubbed', () => {
  const clean = sanitize({ 'na\0me': 'kept\0', nested: { api_key: 'arbitrary-fixture-value', text: 'estelle_test_abcdefgh1234' } });
  assert.deepEqual(clean, { name: 'kept', nested: { api_key: '[redacted]', text: '[redacted estelle key]' } });
  assert.equal(JSON.stringify(clean).includes('arbitrary-fixture-value'), false);
});

test('cap reports truncation by Unicode codepoints after redaction', () => {
  const value = cap('😀'.repeat(FIELD_CAP + 10));
  assert.ok(value.startsWith('😀'.repeat(FIELD_CAP)));
  assert.match(value, /10 more characters/);
  assert.equal(cap('short'), 'short');
});

test('nesting and array traversal are bounded', () => {
  let nested = { value: 'leaf' };
  for (let i = 0; i < 40; i++) nested = { nested };
  assert.match(JSON.stringify(sanitize(nested)), /nesting limit/);
  const clean = sanitize(Array(1005).fill('x'));
  assert.equal(clean.length, 1001);
  assert.equal(clean.at(-1), '[truncated: item limit]');
});

test('opaque Rooms proofs and named JSON/prose credentials are redacted before transport', () => {
  const proof = 'a'.repeat(64);
  const fixtures = [
    JSON.stringify({ session_token: proof }),
    `session_token: ${proof}`,
    `session_token=${proof}`,
    `session_token = '${proof}'`,
    `\`session_token\`: \`${proof}\``,
    `{\"session-token\":\"${proof}\",\"account\":\"ordinary\"}`,
    `api_key: \"${proof}\"`,
    `password: 'synthetic passphrase with spaces'`,
  ];
  for (const source of fixtures) {
    const clean = redact(source);
    assert.notEqual(clean, source);
    assert.equal(clean.includes(proof), false);
    assert.equal(clean.includes('synthetic passphrase'), false);
    assert.match(clean, /redacted/);
  }
  assert.equal(JSON.parse(redact(JSON.stringify({ session_token: proof }))).session_token,
    '[redacted named credential]');
});

test('the actual Rooms hook identity sentence cannot publish its opaque session proof', () => {
  const proof = 'f4'.repeat(16);
  for (const source of [`Its session_token is ${proof}.`, `Its session_token is \`${proof}\`.`,
    `Its session_token is ${proof}: pass it as session_token when writing to Rooms.`]) {
    assert.equal(redact(source).includes(proof), false);
    assert.match(redact(source), /redacted named credential/);
  }
  assert.equal(redact('Its session_token is required for posting.'), 'Its session_token is required for posting.');
});

test('credential-label filtering preserves ordinary identifiers, placeholders and existing redactions', () => {
  const ordinary = [
    'session_token: string', 'session_token: undefined', 'max_tokens: 1000',
    'session_token is required for a Room write.',
    'Authorization: Bearer ${ESTELLE_API_KEY}',
    'api_key: "${ESTELLE_API_KEY}"',
    'session_token: "[redacted named credential]"',
  ];
  for (const text of ordinary) assert.equal(redact(text), text);
});

test('Estelle hook context can retain its text without exporting its opaque Rooms proof', () => {
  const proof = 'b'.repeat(64);
  const events = mapClaude({ uuid: 'fixture-context', type: 'attachment',
    timestamp: '2026-10-30T00:00:00Z', attachment: {
      type: 'hook_additional_context', hookEvent: 'UserPromptSubmit',
      content: `Estelle session context: ${JSON.stringify({ session_token: proof })}`,
    } });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'tool_result');
  assert.match(events[0].payload.output, /Estelle session context/);
  assert.equal(JSON.stringify(events).includes(proof), false);
});

test('NUL normalization cannot create an unredacted vendor token after matching', () => {
  const value = 'ghp_' + 'a'.repeat(30);
  const split = value.slice(0, 10) + '\0' + value.slice(10);
  const clean = redact(split);
  assert.equal(clean.includes(value), false);
  assert.equal(clean.includes('\0'), false);
  assert.match(clean, /redacted github token/);
});
