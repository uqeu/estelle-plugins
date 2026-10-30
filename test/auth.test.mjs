import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchCredential } from '../runtime/auth.mjs';

test('migration launcher resolves only the chosen credential and canonical environment wins', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'estelle-auth-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.estelle'), { mode: 0o700 });
  const file = join(directory, '.estelle', 'auth.json');
  await writeFile(file, JSON.stringify({ key: 'synthetic-stored-credential' }), { mode: 0o600 });
  assert.equal(await launchCredential({}, directory), 'synthetic-stored-credential');
  assert.equal(await launchCredential({ ESTELLE_API_KEY: 'canonical', ESTELLE_KEY: 'legacy' }, directory), 'canonical');
  assert.equal(await launchCredential({ ESTELLE_KEY: 'legacy' }, directory), 'legacy');
  assert.equal(await launchCredential({ ESTELLE_API_KEY: 'bad\nheader' }, directory), null);
  if (process.platform !== 'win32') {
    await chmod(file, 0o644);
    assert.equal(await launchCredential({}, directory), null);
  }
});

test('oversized or missing private credential is refused without depending on any CLI binary', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'estelle-auth-bound-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(await launchCredential({}, directory), null);
  await mkdir(join(directory, '.estelle'));
  await writeFile(join(directory, '.estelle', 'auth.json'), 'x'.repeat(16_001), { mode: 0o600 });
  assert.equal(await launchCredential({}, directory), null);
});
