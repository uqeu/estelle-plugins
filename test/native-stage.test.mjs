import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { prepareCloud, stageCloud, parseStageArguments } from '../runtime/native-stage.mjs';

const sessionId = '11111111-2222-4333-8444-555555555555';
const capabilities = { transport_version: 2, tree_snapshot: true, inactive_staging: true };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'native-stage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'repo'), home = join(root, 'home');
  await mkdir(cwd);
  const env = { PATH: process.env.PATH, HOME: root, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = args => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init']); git(['config', 'core.hooksPath', '/dev/null']); git(['config', 'core.ignoreCase', 'false']);
  git(['remote', 'add', 'origin', 'https://github.com/example/repo.git']);
  await writeFile(join(cwd, 'app.py'), 'base\n'); git(['add', '.']); git(['commit', '-m', 'fixture']);
  const dir = join(home, '.codex/sessions/2026/10/31'); await mkdir(dir, { recursive: true });
  const transcriptPath = join(dir, `rollout-${sessionId}.jsonl`);
  const rows = [
    { type: 'session_meta', payload: { id: sessionId, timestamp: '2026-10-31T00:00:00Z', cwd, cli_version: '0.166.0', model_provider: 'estelle', source: 'cli' } },
    { type: 'turn_context', payload: { cwd, model: 'axiom' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'selected visible message' }] } },
  ];
  await writeFile(transcriptPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  await writeFile(join(cwd, 'app.py'), 'staged\n'); git(['add', 'app.py']); await writeFile(join(cwd, 'app.py'), 'working\n');
  return { root, cwd, home, transcriptPath, git, sessionId, harness: 'codex', roomId: 'room-selected',
    payment: 'estelle', model: 'axiom', task: 'Continue the selected task', launchKey: 'selected-launch-key', consent: true, replace: true };
}

function receipt(body, staged = false) {
  return { state: staged ? 'activation_blocked' : 'prepared', room_id: body.room_id,
    source_session: `${body.harness}-${body.native.session_id}`, harness: body.harness, payment: body.payment,
    model: body.model, base_commit: body.ref, safe_to_close_laptop: false, provisioned: staged,
    ...(staged ? { silo_id: 'silo-selected', artifacts_verified: true, workspace_prepared: true,
      native_command_started: false, reason: 'activation_proofs_missing', computer: { requested: 'pause', verified: true } } : {}) };
}

test('consent and explicit launch choices precede network calls or source reads', async () => {
  for (const run of [prepareCloud, stageCloud]) {
    let called = false;
    await assert.rejects(run({}, async () => { called = true; }), /consent_required/);
    assert.equal(called, false);
  }
  let called = false;
  await assert.rejects(prepareCloud({ consent: true, replace: true }, async () => { called = true; }), /stage_arguments/);
  assert.equal(called, false);
});

test('old capability response prevents capture and cannot provision', async () => {
  const options = { consent: true, replace: true, harness: 'codex', sessionId, roomId: 'room-selected',
    payment: 'estelle', model: 'axiom', task: 'explicit task', launchKey: 'selected-launch-key',
    cwd: '/must-not-read', transcriptPath: '/must-not-read/selected.jsonl' };
  const actions = [];
  await assert.rejects(prepareCloud(options, async (_path, body) => {
    actions.push(body.action); return { transport_version: 2, tree_snapshot: true };
  }), /staging_unsupported/);
  assert.deepEqual(actions, ['native_capabilities']);
});

test('prepare sends selected source and Git states without provisioning or changing sharing', async t => {
  const f = await fixture(t), actions = [];
  const out = await prepareCloud(f, async (path, body) => {
    assert.equal(path, '/ade'); actions.push(body.action);
    if (body.action === 'native_capabilities') return capabilities;
    assert.equal(body.action, 'prepare_native'); assert.equal(body.repo, 'example/repo');
    assert.equal(body.ref, f.git(['rev-parse', 'HEAD']).trim()); assert.equal(body.room_id, f.roomId);
    assert.equal(body.payment, 'estelle'); assert.equal(body.model, 'axiom');
    assert.equal(body.silo_id, undefined); assert.equal(body.provision_consent, undefined);
    assert.equal(body.share_context, undefined);
    assert.equal(Buffer.from(body.native.tree[0].index.base64, 'base64').toString(), 'staged\n');
    assert.equal(Buffer.from(body.native.tree[0].worktree.base64, 'base64').toString(), 'working\n');
    return { ...receipt(body), ignored_private_server_field: 'must-not-print' };
  });
  assert.deepEqual(actions, ['native_capabilities', 'prepare_native']);
  assert.equal(out.state, 'prepared'); assert.equal(out.provisioned, false); assert.equal(out.safe_to_close_laptop, false);
  assert.doesNotMatch(JSON.stringify(out), /must-not-print|selected visible message/);
});

test('stage requires separate provisioning consent and validates preparation before one paid request', async t => {
  const f = await fixture(t), actions = [];
  await assert.rejects(stageCloud(f, async () => { throw new Error('must-not-request'); }), /provision_consent/);
  const out = await stageCloud({ ...f, provisionConsent: true }, async (_path, body) => {
    actions.push(body.action);
    if (body.action === 'native_capabilities') return capabilities;
    if (body.action === 'prepare_native') return receipt(body);
    assert.equal(body.action, 'stage_native'); assert.equal(body.provision_consent, true);
    return receipt(body, true);
  });
  assert.deepEqual(actions, ['native_capabilities', 'prepare_native', 'stage_native']);
  assert.equal(out.outcome, 'staged_inactive'); assert.equal(out.silo_id, 'silo-selected');
  assert.equal(out.native_command_started, false); assert.equal(out.safe_to_close_laptop, false);
});

test('mismatched preparation cannot reach spending and source is never sent through a Room post', async t => {
  const f = await fixture(t), actions = [];
  await assert.rejects(stageCloud({ ...f, provisionConsent: true }, async (_path, body) => {
    actions.push(body.action);
    return body.action === 'native_capabilities' ? capabilities : { ...receipt(body), model: 'different' };
  }), /receipt_mismatch/);
  assert.deepEqual(actions, ['native_capabilities', 'prepare_native']);
});

test('unknown paid outcome is never retried automatically', async t => {
  const f = await fixture(t), actions = [];
  await assert.rejects(stageCloud({ ...f, provisionConsent: true }, async (_path, body) => {
    actions.push(body.action);
    if (body.action === 'native_capabilities') return capabilities;
    if (body.action === 'prepare_native') return receipt(body);
    throw new Error('lost response');
  }), /lost response/);
  assert.equal(actions.filter(action => action === 'stage_native').length, 1);
});

test('failed pause and no-new-computer receipts remain incomplete and keep recovery identity', async t => {
  const f = await fixture(t);
  for (const mutation of [
    { computer: { requested: 'pause', verified: false } },
    { provisioned: false, reason: 'no_new_computer_staged', artifacts_verified: false },
    { reason: 'native_stage_incomplete', artifacts_verified: false, computer: { requested: 'stop', verified: true } },
  ]) {
    const out = await stageCloud({ ...f, provisionConsent: true }, async (_path, body) => {
      if (body.action === 'native_capabilities') return capabilities;
      if (body.action === 'prepare_native') return receipt(body);
      return { ...receipt(body, true), ...mutation };
    });
    assert.equal(out.outcome, 'incomplete'); assert.equal(out.silo_id, 'silo-selected');
    assert.equal(out.safe_to_close_laptop, false);
  }
});

test('unsafe or unrelated staged receipt is refused instead of gaining a handover claim', async t => {
  const f = await fixture(t);
  for (const mutation of [{ safe_to_close_laptop: true }, { native_command_started: true },
    { room_id: 'other-room' }, { source_session: 'other-session' }]) {
    await assert.rejects(stageCloud({ ...f, provisionConsent: true }, async (_path, body) => {
      if (body.action === 'native_capabilities') return capabilities;
      if (body.action === 'prepare_native') return receipt(body);
      return { ...receipt(body, true), ...mutation };
    }), /receipt_mismatch/);
  }
});

test('unknown provisioning remains null rather than becoming a no-charge claim', async t => {
  const f = await fixture(t);
  const out = await stageCloud({ ...f, provisionConsent: true }, async (_path, body) => {
    if (body.action === 'native_capabilities') return capabilities;
    if (body.action === 'prepare_native') return receipt(body);
    return { ...receipt(body, true), provisioned: null, silo_id: '', artifacts_verified: false,
      reason: 'no_new_computer_staged', launch_outcome: 'unknown' };
  });
  assert.equal(out.outcome, 'incomplete'); assert.equal(out.provisioned, null);
  assert.equal(out.launch_outcome, 'unknown'); assert.equal(out.silo_id, '');
  assert.equal(out.safe_to_close_laptop, false);
});

test('malformed computer identities cannot become staged or recovery identities', async t => {
  const f = await fixture(t);
  for (const silo_id of [123, ['silo-selected'], null, { value: 'silo-selected' },
    'estelle_live_' + 'z'.repeat(24), 'sk_live_' + 'z'.repeat(24)]) {
    await assert.rejects(stageCloud({ ...f, provisionConsent: true }, async (_path, body) => {
      if (body.action === 'native_capabilities') return capabilities;
      if (body.action === 'prepare_native') return receipt(body);
      return { ...receipt(body, true), silo_id };
    }), /receipt_mismatch/);
  }
});

test('programmatic Room and launch identities are strings before any request or capture', async t => {
  const f = await fixture(t);
  for (const change of [{ roomId: ['room-selected'] }, { roomId: 123 }, { launchKey: ['selected-launch-key'] }, { launchKey: 12345678 },
    { roomId: 'estelle_live_' + 'z'.repeat(24) }, { launchKey: 'estelle_live_' + 'z'.repeat(24) }]) {
    let called = false;
    await assert.rejects(prepareCloud({ ...f, ...change }, async () => { called = true; }), /stage_arguments/);
    assert.equal(called, false);
  }
});

test('argument parser rejects duplicates, missing values and implicit paid actions', () => {
  const args = ['--harness', 'codex', '--session', sessionId, '--transcript', '/explicit/file', '--repo', '/explicit/repo',
    '--room', 'room-selected', '--payment', 'estelle', '--model', 'axiom', '--task', 'explicit task', '--launch-key', 'selected-launch-key', '--consent', '--replace'];
  const parsed = parseStageArguments(args);
  assert.equal(parsed.provisionConsent, undefined); assert.equal(parsed.cwd, '/explicit/repo');
  assert.throws(() => parseStageArguments([...args, '--model', 'different']), /stage_arguments/);
  assert.throws(() => parseStageArguments([...args, '--untracked']), /stage_arguments/);
  assert.throws(() => parseStageArguments([...args, '--unknown']), /stage_arguments/);
  assert.deepEqual(parseStageArguments([...args, '--untracked', 'one.py', '--untracked', 'two.py']).selectedUntracked, ['one.py', 'two.py']);
});

test('actual CLI reaches both preparation and staging over bounded authenticated HTTP', async t => {
  const f = await fixture(t), actions = [];
  let badReceipt = false;
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const part of request) chunks.push(part);
    const body = JSON.parse(Buffer.concat(chunks)); actions.push(body.action);
    assert.equal(request.url, '/ade'); assert.equal(request.headers.authorization, 'Bearer synthetic-fixture-only');
    response.setHeader('Content-Type', 'application/json');
    const result = body.action === 'native_capabilities' ? capabilities : receipt(body, body.action === 'stage_native');
    if (badReceipt && body.action === 'stage_native') result.silo_id = 'estelle_live_' + 'z'.repeat(24);
    response.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const args = ['--harness', f.harness, '--session', sessionId, '--transcript', f.transcriptPath, '--repo', f.cwd,
    '--room', f.roomId, '--payment', f.payment, '--model', f.model, '--task', f.task, '--launch-key', f.launchKey,
    '--consent', '--replace'];
  const run = command => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['runtime/cli.mjs', command, ...args, ...(command === 'stage-cloud' ? ['--provision-consent'] : [])], {
      cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: f.home, ESTELLE_API_KEY: 'synthetic-fixture-only',
        ESTELLE_API_URL: `http://127.0.0.1:${server.address().port}` }, timeout: 15_000,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
  const preview = await run('prepare-cloud'), staged = await run('stage-cloud');
  assert.equal(preview.code, 0, preview.stderr); assert.equal(staged.code, 0, staged.stderr);
  assert.equal(JSON.parse(preview.stdout).state, 'prepared'); assert.equal(JSON.parse(staged.stdout).outcome, 'staged_inactive');
  assert.doesNotMatch(preview.stdout + staged.stdout, /selected visible message|synthetic-fixture-only/);
  assert.deepEqual(actions, ['native_capabilities', 'prepare_native', 'native_capabilities', 'prepare_native', 'stage_native']);
  badReceipt = true;
  const refused = await run('stage-cloud');
  assert.equal(refused.code, 1); assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /native_receipt_mismatch/);
  assert.doesNotMatch(refused.stderr, /estelle_live_|z{24}/);
  assert.deepEqual(actions.slice(5), ['native_capabilities', 'prepare_native', 'stage_native']);
});
