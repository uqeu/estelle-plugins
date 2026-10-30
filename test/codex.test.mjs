import test from 'node:test';
import assert from 'node:assert/strict';
import { HOOK_EVENTS, normalize, formatContext } from '../adapters/codex.mjs';

const wire = event => {
  const common = { hook_event_name: event, session_id: 'thread-001', cwd: '/tmp/project',
    transcript_path: null, model: 'test-model', turn_id: 'turn-001', permission_mode: 'default' };
  const fields = {
    SessionStart: { source: 'resume' }, SessionEnd: { reason: 'other' },
    UserPromptSubmit: { prompt: 'Continue the task' },
    PreToolUse: { tool_name: 'exec_command', tool_input: { cmd: 'true' }, tool_use_id: 'call-001' },
    PermissionRequest: { tool_name: 'exec_command', tool_input: { cmd: 'true' } },
    PostToolUse: { tool_name: 'exec_command', tool_input: { cmd: 'true' }, tool_use_id: 'call-001', tool_response: { exit_code: 0 } },
    PreCompact: { trigger: 'auto' }, PostCompact: { trigger: 'manual' },
    SubagentStart: { agent_id: 'child-001', agent_type: 'worker' },
    SubagentStop: { agent_id: 'child-001', agent_type: 'worker', agent_transcript_path: null, last_assistant_message: 'Done', stop_hook_active: false },
    Stop: { last_assistant_message: 'Done', stop_hook_active: false },
    PostModelRequest: { status: 'completed', error: null, token_usage: null },
  };
  if (['SessionStart', 'SessionEnd'].includes(event)) delete common.turn_id;
  if (['PreCompact', 'PostCompact', 'PreModelRequest', 'PostModelRequest', 'SessionEnd'].includes(event)) delete common.permission_mode;
  if (event === 'SessionEnd') delete common.model;
  return { ...common, ...fields[event] };
};

test('normalizes every declared native event without generating a transcript path or identity', () => {
  assert.equal(HOOK_EVENTS.length, 14);
  for (const event of HOOK_EVENTS) {
    const payload = wire(event);
    const normalized = normalize(payload);
    assert.equal(normalized.event, event);
    assert.equal(normalized.host, 'codex');
    assert.equal(normalized.sessionId, 'thread-001');
    assert.equal(normalized.transcriptPath, null);
    assert.strictEqual(normalized.raw, payload);
  }
  assert.equal(normalize(wire('SessionStart')).turnId, null);
  assert.equal(normalize(wire('SessionEnd')).model, null);
});

test('preserves tool IDs, arbitrary JSON inputs and original tool output', () => {
  const payload = { ...wire('PostToolUse'), tool_input: false, tool_response: 0 };
  const result = normalize(payload);
  assert.equal(result.toolUseId, 'call-001');
  assert.equal(result.toolInput, false);
  assert.equal(result.toolResponse, 0);
  assert.equal(result.toolName, 'exec_command');
});

test('rejects malformed native identities and lifecycle payloads', () => {
  for (const payload of [null, [], {}, { ...wire('Stop'), session_id: '' },
    { ...wire('Stop'), session_id: 42 }, { ...wire('Stop'), cwd: null },
    { ...wire('Stop'), transcript_path: false }, { ...wire('Stop'), stop_hook_active: 'false' },
    { ...wire('SessionStart'), source: 'something-new' }, { ...wire('PreCompact'), trigger: 'startup' },
    { ...wire('PreToolUse'), permission_mode: 'allow' }, { ...wire('PostModelRequest'), status: 'ok' },
    { ...wire('UserPromptSubmit'), prompt: 42 }, { ...wire('Stop'), hook_event_name: 'PreThink' }]) {
    assert.throws(() => normalize(payload), TypeError);
  }
  const missing = wire('PreToolUse');
  delete missing.tool_input;
  assert.throws(() => normalize(missing), /tool_input is required/);
  const absentTranscript = wire('SessionStart');
  delete absentTranscript.transcript_path;
  assert.throws(() => normalize(absentTranscript), /transcript_path is required/);
});

test('formats the exact native context output shape for all five injecting events', () => {
  const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart'];
  for (const event of events) {
    assert.deepEqual(formatContext('Repository context', event), {
      hookSpecificOutput: { hookEventName: event, additionalContext: 'Repository context' },
    });
    assert.equal(formatContext('', event), null);
  }
});

test('does not inject or issue control directives at observer and compaction boundaries', () => {
  const events = ['PreModelRequest', 'PostModelRequest', 'PreCompact', 'PostCompact',
    'SessionEnd', 'SubagentStop', 'Stop', 'Interrupt', 'PermissionRequest'];
  for (const event of events) assert.equal(formatContext('Do not inject', event), null);
  assert.throws(() => formatContext('context', 'PreThink'), TypeError);
  assert.throws(() => formatContext({}, 'SessionStart'), TypeError);
});

test('allows the native PostToolUse MCP replacement field only at that event', () => {
  const replacement = { content: [{ type: 'text', text: 'Updated result' }] };
  assert.deepEqual(formatContext('Supplement', 'PostToolUse', { updatedMCPToolOutput: replacement }), {
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Supplement', updatedMCPToolOutput: replacement },
  });
  assert.deepEqual(formatContext('', 'PostToolUse', { updatedMCPToolOutput: replacement }), {
    hookSpecificOutput: { hookEventName: 'PostToolUse', updatedMCPToolOutput: replacement },
  });
  for (const event of HOOK_EVENTS.filter(name => name !== 'PostToolUse')) {
    assert.throws(() => formatContext('', event, { updatedMCPToolOutput: replacement }), /requires PostToolUse/);
  }
});
