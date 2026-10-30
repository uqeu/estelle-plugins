import test from 'node:test';
import assert from 'node:assert/strict';
import { mutatingTool, protectWrite } from '../runtime/protect.mjs';

test('local credential protection refuses a real shape without echoing its value', () => {
  const token = 'ghp_' + 'a'.repeat(30);
  for (const host of ['claude-code', 'codex', 'kimi', 'grok']) {
    const output = protectWrite({ host, event: 'PreToolUse', toolName: 'functions.apply_patch', toolInput: { input: `+key=${token}` } });
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
    assert(!JSON.stringify(output).includes(token));
  }
});

test('ordinary edits survive and reads are never treated as writes', () => {
  assert(mutatingTool('functions.apply_patch'));
  assert(!mutatingTool('Read'));
  assert.equal(protectWrite({ event: 'PreToolUse', toolName: 'Write', toolInput: { content: 'export const value = 42;' } }), null);
  assert.equal(protectWrite({ event: 'PreToolUse', toolName: 'Read', toolInput: { path: '/source' } }), null);
  assert.equal(protectWrite({ event: 'PostToolUse', toolName: 'Write', toolInput: { content: 'token=' + 'x'.repeat(20) } }), null);
});

test('JSON source credentials are detected inside Write content and Edit new_string before serialization', () => {
  const proof = 'a4'.repeat(32);
  const source = JSON.stringify({ session_token: proof });
  for (const toolInput of [{ content: source }, { new_string: source }, { edits: [{ new_string: source }] }]) {
    const output = protectWrite({ host: 'codex', event: 'PreToolUse', toolName: 'Edit', toolInput });
    assert.equal(output?.hookSpecificOutput.permissionDecision, 'deny');
    assert(!JSON.stringify(output).includes(proof));
  }
});

test('an input beyond the scanner traversal bound is explicitly unscanned rather than clear', () => {
  const output = protectWrite({ host: 'codex', event: 'PreToolUse', toolName: 'Write',
    toolInput: Array.from({ length: 10_001 }, () => 'ordinary') });
  assert.deepEqual(output, { unscanned: true });
});
