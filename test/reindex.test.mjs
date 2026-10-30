import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { queueReindex } from '../runtime/reindex.mjs';

function git(root, args) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_PREFIX']) delete env[key];
  const result = spawnSync('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', ...args], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function fixture(t) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'estelle-reindex-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo');
  const stateDir = path.join(dir, 'state');
  await mkdir(root);
  git(root, ['init', '-q', '-b', 'main']);
  await writeFile(path.join(root, 'a.ts'), 'export const value = 1;\n');
  await writeFile(path.join(root, '.gitignore'), 'ignored.ts\n');
  git(root, ['add', 'a.ts', '.gitignore']);
  git(root, ['commit', '-qm', 'fixture']);
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(root, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  const repo = { name: 'test/repository', root };
  const calls = [];
  const request = async (route, body) => { calls.push({ route, body }); return { indexed: body.files.length }; };
  const normalized = { host: 'kimi', cwd: root, toolName: 'Write', toolInput: { path: 'a.ts' } };
  return { dir, root, stateDir, repo, normalized, request, calls };
}

const flushInput = data => ({ ...data, normalized: { ...data.normalized, toolInput: {} } });

test('debounce coalesces edits and reads newest bytes only at flush', async t => {
  const data = await fixture(t);
  const initial = await queueReindex({ ...data, now: 100_000 });
  assert.equal(initial.pending, true);
  assert.equal(data.calls.length, 0);
  await writeFile(path.join(data.root, 'a.ts'), 'export const value = 2;\n');
  const result = await queueReindex({ ...flushInput(data), now: 106_000 });
  assert.equal(result.accepted, true);
  assert.equal(result.pending, false);
  assert.equal(data.calls.length, 1);
  assert.equal(data.calls[0].route, '/reindex');
  assert.deepEqual(data.calls[0].body.files, [{ path: 'a.ts', content: 'export const value = 2;\n' }]);
  assert.equal(data.calls[0].body.repo, 'test/repository');
  assert.deepEqual(data.calls[0].body.checkout, { branch: 'main', default_branch: 'main', linked_worktree: false });
});

test('failed network leaves queue intact for a later call', async t => {
  const data = await fixture(t);
  await queueReindex({ ...data, now: 100_000 });
  await assert.rejects(queueReindex({ ...flushInput(data), now: 106_000, request: async () => { throw new Error('offline'); } }));
  const later = await queueReindex({ ...flushInput(data), now: 127_000 });
  assert.equal(later.sent, 1);
  assert.equal(data.calls.length, 1);
});

test('a write during request is retained after old snapshot acknowledgement', async t => {
  const data = await fixture(t);
  await queueReindex({ ...data, now: 100_000 });
  const request = async () => {
    await writeFile(path.join(data.root, 'a.ts'), 'export const changed = 3;\n');
    await queueReindex({ ...data, now: 107_000 });
    return { indexed: 1 };
  };
  const first = await queueReindex({ ...flushInput(data), request, now: 106_000 });
  assert.equal(first.pending, true);
  await queueReindex({ ...flushInput(data), now: 127_000 });
  assert.equal(data.calls[0].body.files[0].content, 'export const changed = 3;\n');
});

test('worktrees share repository rate spacing and carry their own checkout facts', async t => {
  const data = await fixture(t);
  const laneRoot = path.join(data.dir, 'lane');
  git(data.root, ['worktree', 'add', '-qb', 'lane/feature', laneRoot]);
  const lane = { ...data, repo: { ...data.repo, root: laneRoot }, normalized: { ...data.normalized, cwd: laneRoot } };
  await queueReindex({ ...data, now: 100_000 });
  await queueReindex({ ...lane, now: 100_000 });
  await queueReindex({ ...flushInput(data), now: 106_000 });
  const held = await queueReindex({ ...flushInput(lane), now: 107_000 });
  assert.equal(held.pending, true);
  assert.equal(data.calls.length, 1);
  await queueReindex({ ...flushInput(lane), now: 127_000 });
  assert.equal(data.calls.length, 2);
  assert.equal(data.calls[1].body.checkout.branch, 'lane/feature');
  assert.equal(data.calls[1].body.checkout.linked_worktree, true);
});

test('off-default server skip is consumed without claiming graph currency', async t => {
  const data = await fixture(t);
  await queueReindex({ ...data, now: 100_000 });
  const result = await queueReindex({ ...flushInput(data), now: 106_000,
    request: async () => ({ skipped_off_default: true }) });
  assert.equal(result.accepted, false);
  assert.equal(result.skippedOffDefault, true);
  assert.equal(result.pending, false);
  assert.equal(Object.hasOwn(result, 'current'), false);
});

test('ignored, credential, non-source and outside paths never reach a request', async t => {
  const data = await fixture(t);
  await writeFile(path.join(data.root, 'ignored.ts'), 'export const ignored = true;');
  await writeFile(path.join(data.dir, 'outside.ts'), 'export const outside = true;');
  await symlink(path.join(data.dir, 'outside.ts'), path.join(data.root, 'link.ts'));
  for (const file of ['ignored.ts', '.env', 'credentials.json', '../outside.ts', 'link.ts', 'asset.png']) {
    const result = await queueReindex({ ...data, normalized: { ...data.normalized, toolInput: { path: file } }, now: 100_000 });
    assert.equal(result.pending, false);
  }
  assert.equal(data.calls.length, 0);
});

test('credential-shaped content and oversized files are not sent', async t => {
  const data = await fixture(t);
  await writeFile(path.join(data.root, 'a.ts'), 'const token = "estelle_live_abcdefghijklmnopqrstuvwxyz";');
  await queueReindex({ ...data, now: 100_000 });
  const secretResult = await queueReindex({ ...flushInput(data), now: 106_000 });
  assert.equal(secretResult.sent, 0);
  assert.equal(secretResult.excluded, 1);
  assert.equal(secretResult.incomplete, true);
  assert.equal(data.calls.length, 0);
  await writeFile(path.join(data.root, 'a.ts'), 'x'.repeat(256_001));
  await queueReindex({ ...data, now: 130_000 });
  assert.equal((await queueReindex({ ...flushInput(data), now: 136_000 })).sent, 0);
  assert.equal(data.calls.length, 0);
});

test('request bytes are bounded and unconsumed paths stay pending', async t => {
  const data = await fixture(t);
  const headers = [];
  for (let index = 0; index < 10; index++) {
    const name = `big-${index}.ts`;
    await writeFile(path.join(data.root, name), 'x'.repeat(255_000));
    headers.push(`*** Add File: ${name}`);
  }
  const normalized = { ...data.normalized, toolInput: { input: `*** Begin Patch\n${headers.join('\n')}\n*** End Patch` } };
  await queueReindex({ ...data, normalized, now: 100_000 });
  const first = await queueReindex({ ...flushInput(data), now: 106_000 });
  assert.equal(first.pending, true);
  assert.equal(Buffer.byteLength(JSON.stringify(data.calls[0].body)) < 2_000_000, true);
  assert.equal(data.calls[0].body.files.length, 7);
  const next = await queueReindex({ ...flushInput(data), now: 127_000 });
  assert.equal(next.pending, false);
  assert.equal(data.calls[1].body.files.length, 3);
});

test('an apply_patch payload past path bounds is refused before queuing', async t => {
  const data = await fixture(t);
  const headers = Array.from({ length: 101 }, (_, i) => `*** Add File: ${i}.ts`);
  const normalized = { ...data.normalized, toolInput: { input: `*** Begin Patch\n${headers.join('\n')}\n*** End Patch` } };
  await assert.rejects(queueReindex({ ...data, normalized, now: 100_000 }), /reindex_path_bound/);
  assert.equal(data.calls.length, 0);
});

test('tracked file deletion is sent as removed', async t => {
  const data = await fixture(t);
  await rm(path.join(data.root, 'a.ts'));
  await queueReindex({ ...data, now: 100_000 });
  await queueReindex({ ...flushInput(data), now: 106_000 });
  assert.deepEqual(data.calls[0].body.removed, ['a.ts']);
  assert.deepEqual(data.calls[0].body.files, []);
});

test('apply_patch headers coalesce every named file, including command payload', async t => {
  const data = await fixture(t);
  await writeFile(path.join(data.root, 'b.ts'), 'export const b = true;');
  const normalized = { ...data.normalized, toolName: 'apply_patch', toolInput: { command:
    '*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n*** Add File: b.ts\n+new\n*** End Patch' } };
  await queueReindex({ ...data, normalized, now: 100_000 });
  await queueReindex({ ...flushInput(data), now: 106_000 });
  assert.deepEqual(data.calls[0].body.files.map(file => file.path), ['a.ts', 'b.ts']);
  const spoolFiles = await readdir(path.join(data.stateDir, 'reindex'));
  for (const name of spoolFiles) {
    const raw = await readFile(path.join(data.stateDir, 'reindex', name), 'utf8');
    assert.equal(raw.includes('export const'), false);
  }
});
