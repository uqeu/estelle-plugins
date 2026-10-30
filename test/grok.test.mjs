import test from 'node:test';
import assert from 'node:assert/strict';
import { HOOK_EVENTS, normalize, formatContext } from '../adapters/grok.mjs';

const payload = (event = 'pre_tool_use') => ({ hookEventName: event, sessionId: 'grok-session',
  cwd: '/tmp/project', workspaceRoot: '/tmp/project', timestamp: '2026-10-30T16:00:00Z',
  promptId: 'prompt-1', toolName: 'run_terminal_cmd', toolUseId: 'call-1', toolInput: { command: 'true' } });

test('normalizes every native Grok event and retains the actual host identity', () => {
  assert.equal(HOOK_EVENTS.length, 15);
  for (const event of HOOK_EVENTS) {
    const value = payload(event);
    const result = normalize(value);
    assert.equal(result.event, event);
    assert.equal(result.sessionId, 'grok-session');
    assert.equal(result.transcriptPath, null);
    assert.strictEqual(result.raw, value);
  }
  assert.equal(normalize(payload()).event, 'PreToolUse');
  assert.equal(normalize(payload('subagent_end')).event, 'SubagentStop');
});

test('prefers native camelCase over conflicting compatibility aliases', () => {
  const result = normalize({ ...payload(), hook_event_name: 'Stop', session_id: 'wrong-session',
    tool_name: 'wrong-tool', tool_input: 'wrong-input', toolResult: false, tool_response: 'wrong-result' });
  assert.equal(result.event, 'PreToolUse');
  assert.equal(result.sessionId, 'grok-session');
  assert.equal(result.toolName, 'run_terminal_cmd');
  assert.deepEqual(result.toolInput, { command: 'true' });
  assert.equal(result.toolResponse, false);
  assert.equal(result.toolUseId, 'call-1');
});

test('accepts supported snake aliases and preserves missing transcripts and subagent IDs', () => {
  const result = normalize({ hook_event_name: 'SubagentStart', session_id: 'parent', cwd: '/tmp/project',
    subagentId: 'child', subagentType: 'worker' });
  assert.equal(result.event, 'SubagentStart');
  assert.equal(result.sessionId, 'parent');
  assert.equal(result.agentId, 'child');
  assert.equal(result.agentType, 'worker');
  assert.equal(result.turnId, null);
  assert.equal(result.transcriptPath, null);
});

test('rejects malformed identity, false camelCase fallback and unknown hooks', () => {
  for (const value of [null, [], {}, { ...payload(), sessionId: '' },
    { ...payload(), sessionId: false, session_id: 'must-not-fallback' },
    { ...payload(), cwd: null }, { ...payload(), transcriptPath: false },
    { ...payload(), hookEventName: 'PreModelRequest' }, { ...payload(), toolName: 1 }]) {
    assert.throws(() => normalize(value), TypeError);
  }
  const noInput = payload(); delete noInput.toolInput;
  assert.throws(() => normalize(noInput), /toolInput is required/);
});

test('emits only the verified native context-bearing outputs', () => {
  for (const event of ['PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop']) {
    assert.deepEqual(formatContext('Shared context', event), { hookSpecificOutput: { additionalContext: 'Shared context' } });
  }
  for (const event of ['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'PreCompact', 'PostCompact',
    'SessionEnd', 'Notification', 'PermissionDenied', 'PostToolUseFailure', 'StopFailure', 'StopCancelled']) {
    assert.equal(formatContext('Must not inject', event), null);
  }
  assert.equal(formatContext('', 'PostToolUse'), null);
  assert.throws(() => formatContext('context', 'PreModelRequest'), TypeError);
});

test('limits MCP output replacement to PostToolUse and preserves its structured JSON', () => {
  const value = { content: [{ type: 'text', text: 'tool result' }] };
  assert.deepEqual(formatContext('', 'PostToolUse', { updatedMCPToolOutput: value }), {
    hookSpecificOutput: { updatedMCPToolOutput: value },
  });
  for (const event of HOOK_EVENTS.filter(event => event !== 'PostToolUse')) {
    assert.throws(() => formatContext('context', event, { updatedMCPToolOutput: value }), /requires PostToolUse/);
  }
});
