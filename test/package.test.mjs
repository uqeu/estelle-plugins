import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { VERSION } from '../runtime/version.mjs';

const root = resolve(import.meta.dirname, '..');
const json = async file => JSON.parse(await readFile(join(root, file), 'utf8'));

test('native packages use bundled local runners and respect host teardown contracts', async () => {
  for (const [file, variable, host] of [
    ['hooks/claude.json', 'CLAUDE_PLUGIN_ROOT', 'claude-code'],
    ['hooks/codex.json', 'PLUGIN_ROOT', 'codex'],
    ['plugins/grok/hooks/hooks.json', 'GROK_PLUGIN_ROOT', 'grok'],
  ]) {
    const config = await json(file);
    assert(Object.keys(config.hooks).length >= 8);
    for (const [event, groups] of Object.entries(config.hooks)) for (const group of groups) {
      for (const hook of group.hooks) {
        assert.equal(hook.type, 'command');
        assert.equal(hook.command, `node "\${${variable}}/runtime/cli.mjs" hook ${host}`);
        assert(!/npx|cargo|@fatelabs\/estelle|estelle hook/.test(hook.command));
        if (['SessionEnd', 'Interrupt'].includes(event)) {
          assert.equal(hook.timeout, 3);
          assert.notEqual(hook.async, true);
        }
      }
    }
  }
  const kimi = await json('kimi.plugin.json');
  assert.equal(kimi.sessionStart.skill, 'estelle');
  assert.equal(kimi.mcpServers.Estelle.bearerTokenEnvVar, 'ESTELLE_API_KEY');
  for (const hook of kimi.hooks) {
    assert.deepEqual(Object.keys(hook).sort(), ['command', 'event', 'timeout']);
    assert.equal(hook.command, 'node "${KIMI_PLUGIN_ROOT}/runtime/cli.mjs" hook kimi');
  }
});

test('every host keeps its own manifest paths inside the installed package', async () => {
  for (const [packageRoot, manifestFile] of [
    ['plugins/estelle', '.claude-plugin/plugin.json'],
    ['plugins/estelle', '.codex-plugin/plugin.json'],
    ['plugins/grok', 'plugin.json'],
  ]) {
    const base = join(root, packageRoot);
    const manifest = JSON.parse(await readFile(join(base, manifestFile), 'utf8'));
    assert.equal(manifest.version, VERSION);
    assert.match(VERSION, /^\d+\.\d+\.\d+$/);
    for (const field of ['hooks', 'mcpServers', 'skills']) {
      if (typeof manifest[field] !== 'string') continue;
      const target = resolve(base, manifest[field]);
      const rel = relative(base, target);
      assert(rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel));
      await access(target);
    }
    await access(join(base, 'runtime', 'cli.mjs'));
    await access(join(base, 'runtime', 'kimi-history.mjs'));
  }
  const codex = await json('.mcp.codex.json');
  const claude = await json('.mcp.claude.json');
  const grok = await json('plugins/grok/.mcp.json');
  assert.equal(codex.mcpServers.Estelle.bearer_token_env_var, 'ESTELLE_API_KEY');
  assert.equal(grok.mcpServers.Estelle.bearer_token_env_var, 'ESTELLE_API_KEY');
  assert.equal(claude.mcpServers.Estelle.headers.Authorization, 'Bearer ${ESTELLE_API_KEY}');
});

test('generated artifact check detects a changed runner rather than trusting a source-only pass', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'estelle-package-check-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await cp(root, temporary, { recursive: true, filter: source => !relative(root, source).split('/').includes('.git') });
  const run = () => spawnSync(process.execPath, ['scripts/build.mjs', '--check'], {
    cwd: temporary, encoding: 'utf8', timeout: 10_000, maxBuffer: 100_000,
  });
  assert.equal(run().status, 0);
  const runner = join(temporary, 'plugins', 'estelle', 'runtime', 'cli.mjs');
  await writeFile(runner, '// deliberately broken generated runner\n');
  const broken = run();
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /Bundle differs: estelle\/runtime/);
});
