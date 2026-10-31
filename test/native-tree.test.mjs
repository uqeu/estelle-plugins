import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renameSync } from 'node:fs';
import childProcess, { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
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
const posixModes = { skip: process.platform === 'win32' && 'POSIX filesystem executable bits are unavailable on Windows' };

// Observe real Git after each command without relying on executable shebang shims.
async function observeGit(afterGit, action) {
  const original = childProcess.execFileSync;
  childProcess.execFileSync = (file, args, ...options) => {
    const output = original(file, args, ...options);
    if (file === 'git') afterGit(args, original);
    return output;
  };
  syncBuiltinESMExports();
  try { await action(); }
  finally { childProcess.execFileSync = original; syncBuiltinESMExports(); }
  assert.equal(childProcess.execFileSync, original);
  assert.equal(execFileSync, original);
}

test('selected tree preserves partial staging, deletions and binary files on every OS', async t => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, 'app.py'), 'staged\n'); f.git(['add', 'app.py']);
  await writeFile(join(f.cwd, 'app.py'), 'unstaged\n');
  await rm(join(f.cwd, 'delete.py'));
  await writeFile(join(f.cwd, 'new image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]));
  await assert.rejects(captureTree(f), /untracked_selection_required/);
  const out = await captureTree({ ...f, selectedUntracked: ['new image.png'] });
  const by = Object.fromEntries(out.tree.map(row => [row.path, row]));
  assert.deepEqual(bytes(by['app.py'].index), Buffer.from('staged\n'));
  assert.deepEqual(bytes(by['app.py'].worktree), Buffer.from('unstaged\n'));
  assert.equal(by['app.py'].index.mode, '100644');
  assert.equal(by['delete.py'].worktree, null); assert.deepEqual(bytes(by['delete.py'].index), Buffer.from('base\n'));
  assert.equal(by['new image.png'].index, null); assert.deepEqual(bytes(by['new image.png'].worktree), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]));
});

test('POSIX worktree executable mode remains distinct from the staged mode', posixModes, async t => {
  const f = await fixture(t);
  await chmod(join(f.cwd, 'app.py'), 0o755);
  const out = await captureTree(f);
  assert.equal(out.tree[0].index.mode, '100644');
  assert.equal(out.tree[0].worktree.mode, '100755');
});

test('staged executable mode and its removal round-trip through the Git index on every OS', async t => {
  const f = await fixture(t);
  f.git(['update-index', '--chmod=+x', 'app.py']);
  let out = await captureTree(f);
  assert.equal(out.tree.length, 1); assert.equal(out.tree[0].index.mode, '100755');
  assert.deepEqual(bytes(out.tree[0].index), Buffer.from('base\n'));
  f.git(['update-index', '--chmod=-x', 'app.py']);
  await writeFile(join(f.cwd, 'app.py'), 'worktree\n');
  out = await captureTree(f);
  assert.equal(out.tree[0].index.mode, '100644');
  assert.deepEqual(bytes(out.tree[0].worktree), Buffer.from('worktree\n'));
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

test('staged deletion preserves null index and worktree entries on every OS', async t => {
  const f = await fixture(t);
  f.git(['rm', 'delete.py']);
  const out = await captureTree(f);
  assert.equal(out.tree.length, 1); assert.equal(out.tree[0].path, 'delete.py');
  assert.equal(out.tree[0].index, null); assert.equal(out.tree[0].worktree, null);
});

test('POSIX executable-to-nonexecutable transition preserves distinct modes', posixModes, async t => {
  const f = await fixture(t);
  await chmod(join(f.cwd, 'app.py'), 0o755); f.git(['add', 'app.py']); f.git(['commit', '-m', 'executable']);
  await chmod(join(f.cwd, 'app.py'), 0o644);
  const out = await captureTree(f);
  assert.equal(out.tree.length, 1); assert.equal(out.tree[0].path, 'app.py');
  assert.equal(out.tree[0].index.mode, '100755'); assert.equal(out.tree[0].worktree.mode, '100644');
});

test('POSIX literal-star and leading-space filenames do not select their siblings', {
  skip: process.platform === 'win32' && 'Windows filenames cannot contain a literal star',
}, async t => {
  const f = await fixture(t);
  for (const name of ['wild*.py', 'wild-other.py', ' app.py']) await writeFile(join(f.cwd, name), 'base\n');
  f.git(['add', '.']); f.git(['commit', '-m', 'names']);
  await writeFile(join(f.cwd, 'wild*.py'), 'changed\n'); await writeFile(join(f.cwd, ' app.py'), 'space\n');
  const out = await captureTree(f);
  assert.deepEqual(out.tree.map(row => row.path), [' app.py', 'wild*.py']);
  assert.deepEqual(bytes(out.tree[0].worktree), Buffer.from('space\n'));
});

test('literal bracket and leading-space filenames do not select their siblings on every OS', async t => {
  const f = await fixture(t);
  for (const name of ['wild[1].py', 'wild1.py', ' app.py', 'app-other.py']) await writeFile(join(f.cwd, name), 'base\n');
  f.git(['add', '.']); f.git(['commit', '-m', 'portable names']);
  await writeFile(join(f.cwd, 'wild[1].py'), 'bracket\n'); await writeFile(join(f.cwd, ' app.py'), 'space\n');
  const out = await captureTree(f);
  assert.deepEqual(out.tree.map(row => row.path), [' app.py', 'wild[1].py']);
  assert.deepEqual(bytes(out.tree[0].worktree), Buffer.from('space\n'));
  assert.deepEqual(bytes(out.tree[1].worktree), Buffer.from('bracket\n'));
  assert.deepEqual(bytes(out.tree[1].index), Buffer.from('base\n'));
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

test('POSIX mode observation does not trust hiding config or alter that config', posixModes, async t => {
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
  const f = await fixture(t);
  let observations = 0, injected = false;
  await observeGit((args, realGit) => {
    if (!args.includes('--debug')) return;
    observations++;
    if (observations === 1) {
      realGit('git', ['-C', f.cwd, 'update-index', '--assume-unchanged', 'app.py']);
      injected = true;
    }
  }, () => assert.rejects(captureTree(f), /index_state_unsupported/));
  // A second flag observation catches the change even though diff sees no dirt.
  assert.equal(injected, true); assert.equal(observations, 2);
  assert.match(f.git(['ls-files', '-v', '--', 'app.py']), /^h /);
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
  const f = await fixture(t);
  await writeFile(join(f.cwd, '.gitignore'), 'APP.py\n'); f.git(['add', '.gitignore']); f.git(['commit', '-m', 'ignore alternate']);
  await writeFile(join(f.cwd, 'delete.py'), 'visible edit\n');
  let injections = 0;
  // Case-sensitive Git can detect the changed tree before the final spelling check. Either
  // named refusal preserves the contract; accepting a snapshot after this rename does not.
  await observeGit(args => {
    if (args.includes('cat-file') && args.includes('blob') && injections === 0) {
      renameSync(join(f.cwd, 'app.py'), join(f.cwd, 'APP.py'));
      injections++;
    }
  }, () => assert.rejects(captureTree(f), /^Error: native_(?:index_state_unsupported|artifact_changed)$/));
  assert.equal(injections, 1);
});
