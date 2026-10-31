import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { prepareContinuation } from '../runtime/native-export.mjs';
import { indexSpelling } from '../runtime/native-index.mjs';
import { captureTree, prepareTreeContinuation, continueTreeCloud } from '../runtime/native-tree.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'native-tree-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'repo'); await mkdir(cwd);
  const env = { PATH: process.env.PATH, HOME: root, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = args => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init']); git(['config', 'core.hooksPath', '/dev/null']); git(['config', 'core.fileMode', 'true']); git(['config', 'core.ignoreCase', 'false']);
  git(['remote', 'add', 'origin', 'https://github.com/example/repo.git']);
  await writeFile(join(cwd, 'app.py'), 'base\n'); await writeFile(join(cwd, 'delete.py'), 'base\n');
  git(['add', '.']); git(['commit', '-m', 'fixture']);
  return { cwd, git, root };
}
const bytes = blob => blob === null ? null : Buffer.from(blob.base64, 'base64');

test('selected tree preserves partial staging, deletions, binary files and executable modes', async t => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, 'app.py'), 'staged\n'); f.git(['add', 'app.py']);
  await writeFile(join(f.cwd, 'app.py'), 'unstaged\n'); await chmod(join(f.cwd, 'app.py'), 0o755);
  await rm(join(f.cwd, 'delete.py'));
  await writeFile(join(f.cwd, 'new image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]));
  await assert.rejects(captureTree(f), /untracked_selection_required/);
  const out = await captureTree({ ...f, selectedUntracked: ['new image.png'] });
  const by = Object.fromEntries(out.tree.map(row => [row.path, row]));
  assert.deepEqual(bytes(by['app.py'].index), Buffer.from('staged\n'));
  assert.deepEqual(bytes(by['app.py'].worktree), Buffer.from('unstaged\n'));
  assert.equal(by['app.py'].worktree.mode, '100755'); assert.equal(by['app.py'].index.mode, '100644');
  assert.equal(by['delete.py'].worktree, null); assert.deepEqual(bytes(by['delete.py'].index), Buffer.from('base\n'));
  assert.equal(by['new image.png'].index, null); assert.deepEqual(bytes(by['new image.png'].worktree), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]));
});

test('staged work is captured even when worktree was restored to HEAD bytes', async t => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, 'app.py'), 'staged\n'); f.git(['add', 'app.py']);
  await writeFile(join(f.cwd, 'app.py'), 'base\n');
  const out = await captureTree(f);
  assert.equal(out.tree.length, 1); assert.equal(out.tree[0].path, 'app.py');
  assert.deepEqual(bytes(out.tree[0].index), Buffer.from('staged\n'));
  assert.deepEqual(bytes(out.tree[0].worktree), Buffer.from('base\n'));
});

test('staged deletion and executable-to-nonexecutable transitions remain distinct', async t => {
  const f = await fixture(t);
  await chmod(join(f.cwd, 'app.py'), 0o755); f.git(['add', 'app.py']); f.git(['commit', '-m', 'executable']);
  await chmod(join(f.cwd, 'app.py'), 0o644); f.git(['rm', 'delete.py']);
  const out = await captureTree(f), by = Object.fromEntries(out.tree.map(row => [row.path, row]));
  assert.equal(by['app.py'].index.mode, '100755'); assert.equal(by['app.py'].worktree.mode, '100644');
  assert.equal(by['delete.py'].index, null); assert.equal(by['delete.py'].worktree, null);
});

test('literal wildcard and leading-space filenames do not select their siblings', async t => {
  const f = await fixture(t);
  for (const name of ['wild*.py', 'wild-other.py', ' app.py']) await writeFile(join(f.cwd, name), 'base\n');
  f.git(['add', '.']); f.git(['commit', '-m', 'names']);
  await writeFile(join(f.cwd, 'wild*.py'), 'changed\n'); await writeFile(join(f.cwd, ' app.py'), 'space\n');
  const out = await captureTree(f);
  assert.deepEqual(out.tree.map(row => row.path), [' app.py', 'wild*.py']);
  assert.deepEqual(bytes(out.tree[0].worktree), Buffer.from('space\n'));
});

test('reserved credential filenames, parent symlinks and oversized objects are refused', async t => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, '.ENV'), 'synthetic'); f.git(['add', '.ENV']);
  await assert.rejects(captureTree(f), /reserved_path/); f.git(['reset', '--', '.ENV']); await rm(join(f.cwd, '.ENV'));
  await mkdir(join(f.cwd, 'safe')); await writeFile(join(f.cwd, 'safe', 'x.py'), 'base\n');
  f.git(['add', '.']); f.git(['commit', '-m', 'directory']);
  await rm(join(f.cwd, 'safe'), { recursive: true }); await mkdir(join(f.cwd, '.private'));
  await writeFile(join(f.cwd, '.private', 'x.py'), 'unrelated'); await writeFile(join(f.cwd, '.gitignore'), 'safe\n.private\n');
  f.git(['add', '.gitignore']); f.git(['commit', '-m', 'ignore']);
  await symlink('.private', join(f.cwd, 'safe'));
  await assert.rejects(captureTree(f), /reserved_path/);
});

test('byte order marks survive and oversized source refuses instead of truncating', async t => {
  const f = await fixture(t);
  const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('bom\n')]);
  await writeFile(join(f.cwd, 'app.py'), original);
  assert.deepEqual(bytes((await captureTree(f)).tree[0].worktree), original);
  await writeFile(join(f.cwd, 'app.py'), 'x'.repeat(8193));
  await assert.rejects(captureTree(f), /bound/);
});

test('tree continuation requires consent before repository reads', async () => {
  await assert.rejects(prepareTreeContinuation({}), /consent_required/);
});

test('tree protocol is probed before capture and old servers cannot silently ignore tree state', async () => {
  const calls = [];
  await assert.rejects(continueTreeCloud({ consent: true, replace: true, cwd: '/must-not-read' }, async (_path, body) => {
    calls.push(body.action); return { transport_version: 1, tree_snapshot: false };
  }), /transport_unsupported/);
  assert.deepEqual(calls, ['native_capabilities']);
});

test('reachable tree client posts a selected snapshot and requires a matching applied receipt', async t => {
  const f = await fixture(t);
  const sessionId = '11111111-2222-4333-8444-555555555555', home = join(f.root, 'home');
  const dir = join(home, '.claude/projects/project'); await mkdir(dir, { recursive: true });
  const transcriptPath = join(dir, sessionId + '.jsonl');
  await writeFile(transcriptPath, JSON.stringify({ type: 'user', sessionId, message: { role: 'user', content: 'synthetic visible native turn' } }) + '\n');
  await writeFile(join(f.cwd, 'app.py'), 'staged\n'); f.git(['add', 'app.py']); await writeFile(join(f.cwd, 'app.py'), 'worktree\n');
  const options = { ...f, home, transcriptPath, harness: 'claude-code', sessionId, siloId: 'silo-own', consent: true, replace: true };
  let received;
  const request = async (_path, body) => {
    if (body.action === 'native_capabilities') return { transport_version: 2, tree_snapshot: true };
    received = body;
    return { silo_id: options.siloId, session_id: sessionId, harness: options.harness, tree_snapshot_applied: true, artifacts_verified: true, native_command_started: true };
  };
  const result = await continueTreeCloud(options, request);
  assert.equal(result.safe_to_close_laptop, false); assert.equal(result.tree_snapshot_applied, true);
  assert.equal(received.native.files, undefined); assert.equal(received.native.tree.length, 1);
  assert.deepEqual(bytes(received.native.tree[0].index), Buffer.from('staged\n'));
  assert.deepEqual(bytes(received.native.tree[0].worktree), Buffer.from('worktree\n'));
  await assert.rejects(continueTreeCloud(options, async (path, body) => ({ ...(await request(path, body)), tree_snapshot_applied: false })), /restore_unverified/);
});


test('ordinary unchanged index and staged empty file remain supported', async t => {
  const f = await fixture(t);
  assert.deepEqual((await captureTree(f)).tree, []);
  await writeFile(join(f.cwd, 'empty.py'), ''); f.git(['add', 'empty.py']);
  const out = await captureTree(f);
  assert.equal(out.tree.length, 1); assert.equal(out.tree[0].path, 'empty.py');
  assert.deepEqual(bytes(out.tree[0].index), Buffer.alloc(0));
  assert.deepEqual(bytes(out.tree[0].worktree), Buffer.alloc(0));
});

for (const flag of ['--assume-unchanged', '--skip-worktree']) {
  test(`unsupported ${flag} index entries refuse even when Git hides a dirty file`, async t => {
    const f = await fixture(t);
    f.git(['update-index', flag, 'app.py']); await writeFile(join(f.cwd, 'app.py'), 'hidden edit\n');
    assert.equal(f.git(['diff', '--name-only', 'HEAD']), '');
    assert.match(f.git(['ls-files', '-v', '--', 'app.py']), flag === '--assume-unchanged' ? /^h / : /^S /);
    await assert.rejects(captureTree(f), /index_state_unsupported/);
  });
}

test('intent-to-add refuses instead of inventing a staged empty blob', async t => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, 'new.py'), 'not staged\n'); f.git(['add', '-N', 'new.py']);
  assert.equal(f.git(['diff', '--cached', '--name-only']), '');
  await assert.rejects(captureTree(f), /index_state_unsupported/);
});

for (const key of ['core.sparseCheckout', 'index.sparse']) {
  test(`enabled ${key} refuses even before sparse index directories exist`, async t => {
    const f = await fixture(t); f.git(['config', key, 'true']);
    await assert.rejects(captureTree(f), /index_state_unsupported/);
  });
}

test('actual sparse index skip-directory state refuses', async t => {
  const f = await fixture(t);
  await mkdir(join(f.cwd, 'keep')); await mkdir(join(f.cwd, 'omit'));
  await writeFile(join(f.cwd, 'keep', 'a.py'), 'a'); await writeFile(join(f.cwd, 'omit', 'b.py'), 'b');
  f.git(['add', '.']); f.git(['commit', '-m', 'directories']);
  f.git(['sparse-checkout', 'init', '--cone', '--sparse-index']); f.git(['sparse-checkout', 'set', 'keep']);
  assert.match(f.git(['ls-files', '--sparse', '-v']), /^S omit\//m);
  await assert.rejects(captureTree(f), /index_state_unsupported/);
});

test('mode observation does not trust hiding config or alter that config', async t => {
  const f = await fixture(t);
  f.git(['config', 'core.fileMode', 'false']);
  f.git(['config', 'core.fsmonitor', '/must-not-execute']); f.git(['config', 'core.untrackedCache', 'true']);
  await chmod(join(f.cwd, 'app.py'), 0o755);
  const out = await captureTree(f);
  assert.equal(out.tree[0].path, 'app.py'); assert.equal(out.tree[0].worktree.mode, '100755');
  assert.equal(f.git(['config', 'core.fileMode']).trim(), 'false');
  assert.equal(f.git(['config', 'core.fsmonitor']).trim(), '/must-not-execute');
});

test('index flags changing after initial preflight refuse before returning snapshot', async t => {
  const f = await fixture(t), shim = join(f.root, 'bin'); await mkdir(shim);
  const actualGit = realpathSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim());
  const counter = join(f.root, 'preflight-count');
  const source = `#!${process.execPath}\nimport { execFileSync } from 'node:child_process';\nimport { existsSync, readFileSync, writeFileSync } from 'node:fs';\nconst args = process.argv.slice(2);\nconst output = execFileSync(${JSON.stringify(actualGit)}, args);\nif (args.includes('--debug')) {\n const file = ${JSON.stringify(counter)}; const n = existsSync(file) ? Number(readFileSync(file, 'utf8')) + 1 : 1;\n writeFileSync(file, String(n));\n if (n === 1) execFileSync(${JSON.stringify(actualGit)}, ['-C', ${JSON.stringify(f.cwd)}, 'update-index', '--assume-unchanged', 'app.py']);\n}\nprocess.stdout.write(output);\n`;
  await writeFile(join(shim, 'git'), source); await chmod(join(shim, 'git'), 0o755);
  const oldPath = process.env.PATH; process.env.PATH = shim + ':' + oldPath;
  try { await assert.rejects(captureTree(f), /index_state_unsupported/); }
  finally { process.env.PATH = oldPath; }
  // A second flag observation catches the change even though diff sees no dirt.
  assert.equal(Number(await (await import('node:fs/promises')).readFile(counter, 'utf8')), 2);
});


test('matching case-insensitive configuration remains supported without config mutation', async t => {
  const f = await fixture(t); f.git(['config', 'core.ignoreCase', 'true']);
  await writeFile(join(f.cwd, 'app.py'), 'changed\n');
  const out = await captureTree(f);
  assert.equal(out.tree.length, 1); assert.deepEqual(bytes(out.tree[0].worktree), Buffer.from('changed\n'));
  assert.equal(f.git(['config', 'core.ignoreCase']).trim(), 'true');
});

for (const configured of ['true', 'false']) {
  test(`case-only rename refuses with core.ignoreCase=${configured}`, async t => {
    const f = await fixture(t); f.git(['config', 'core.ignoreCase', configured]);
    await rename(join(f.cwd, 'app.py'), join(f.cwd, 'APP.py'));
    await assert.rejects(captureTree({ ...f, selectedUntracked: ['APP.py'] }), /index_state_unsupported/);
  });
}


test('legacy native import also refuses hidden index state before native file reads', async t => {
  const f = await fixture(t); f.git(['update-index', '--assume-unchanged', 'app.py']);
  await writeFile(join(f.cwd, 'app.py'), 'hidden edit\n');
  await assert.rejects(prepareContinuation({ ...f, consent: true, replace: true, siloId: 'own', harness: 'codex',
    sessionId: '11111111-2222-4333-8444-555555555555', transcriptPath: '/must-not-read' }), /index_state_unsupported/);
});

test('indexed metadata inventory bound refuses before opening any repository directory', async () => {
  await assert.rejects(indexSpelling('/must-not-read', { tagged: 'H a\0'.repeat(10_001) }), /artifact_bound/);
});

test('case-only rename during blob capture refuses the snapshot on either filesystem type', async t => {
  const f = await fixture(t), shim = join(f.root, 'bin'); await mkdir(shim);
  await writeFile(join(f.cwd, '.gitignore'), 'APP.py\n'); f.git(['add', '.gitignore']); f.git(['commit', '-m', 'ignore alternate']);
  await writeFile(join(f.cwd, 'delete.py'), 'visible edit\n');
  const actualGit = realpathSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim());
  const counter = join(f.root, 'blob-count');
  const source = `#!${process.execPath}\nimport { execFileSync } from 'node:child_process';\nimport { existsSync, renameSync, writeFileSync } from 'node:fs';\nconst args = process.argv.slice(2);\nconst output = execFileSync(${JSON.stringify(actualGit)}, args);\nif (args.includes('cat-file') && args.includes('blob') && !existsSync(${JSON.stringify(counter)})) {\n writeFileSync(${JSON.stringify(counter)}, '1');\n renameSync(${JSON.stringify(join(f.cwd, 'app.py'))}, ${JSON.stringify(join(f.cwd, 'APP.py'))});\n}\nprocess.stdout.write(output);\n`;
  await writeFile(join(shim, 'git'), source); await chmod(join(shim, 'git'), 0o755);
  const oldPath = process.env.PATH; process.env.PATH = shim + ':' + oldPath;
  // Case-sensitive Git can detect the changed tree before the final spelling check. Either
  // named refusal preserves the contract; accepting a snapshot after this rename does not.
  try { await assert.rejects(captureTree(f), /^Error: native_(?:index_state_unsupported|artifact_changed)$/); }
  finally { process.env.PATH = oldPath; }
  assert.equal(await (await import('node:fs/promises')).readFile(counter, 'utf8'), '1');
});
