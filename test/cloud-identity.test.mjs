import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineIdentity, cloudExecutionIdentity } from '../runtime/identity.mjs';
import { checkpointSession } from '../runtime/checkpoint.mjs';

const execution = 'ade-launch-0123456789abcdef';
test('cloud execution timeline is separate from restored native UUID and local proof identity', () => {
  const native = '11111111-2222-4333-8444-555555555555';
  assert.equal(timelineIdentity('codex', native, {}), `codex-${native}`);
  assert.equal(timelineIdentity('codex', native, { ESTELLE_EXECUTION_SESSION_ID: execution }), execution);
  assert.notEqual(timelineIdentity('codex', native, {}), timelineIdentity('codex', native, { ESTELLE_EXECUTION_SESSION_ID: execution }));
  assert.equal(cloudExecutionIdentity({}), '');
  assert.throws(() => timelineIdentity('codex', native, { ESTELLE_EXECUTION_SESSION_ID: 'codex-somebody-elses-native' }), /invalid/);
});

test('unsupported private cloud checkpoint does not read native artifact or fall back to source UUID', async () => {
  const previous = process.env.ESTELLE_EXECUTION_SESSION_ID;
  process.env.ESTELLE_EXECUTION_SESSION_ID = execution;
  try {
    let called = false;
    const result = await checkpointSession({ host: 'codex', payload: { session_id: 'native', transcript_path: '/must-not-read' },
      request: async () => { called = true; } });
    assert.equal(called, false);
    assert.equal(result.saved, false);
    assert.equal(result.unsupported, true);
  } finally {
    if (previous === undefined) delete process.env.ESTELLE_EXECUTION_SESSION_ID;
    else process.env.ESTELLE_EXECUTION_SESSION_ID = previous;
  }
});
