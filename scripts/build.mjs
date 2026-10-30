import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const description = 'Estelle MCP, memory and session hooks for coding agents.';
const json = value => JSON.stringify(value, null, 2) + '\n';
const generated = new Map();
const emit = (file, value) => generated.set(file, typeof value === 'string' ? value : json(value));
emit('runtime/version.mjs', `// Generated from package.json by scripts/build.mjs.\nexport const VERSION = '${version}';\n`);
const server = { url: 'https://api.fatelabs.ca/mcp', bearer_token_env_var: 'ESTELLE_API_KEY' };
const manifests = {
  '.claude-plugin/plugin.json': { name: 'estelle', version, description, license: 'Apache-2.0', author: { name: 'Fate Labs' },
    repository: 'https://github.com/uqeu/estelle-plugins', hooks: './hooks/claude.json', mcpServers: './.mcp.claude.json' },
  '.codex-plugin/plugin.json': { name: 'estelle', version, description, skills: './skills',
    hooks: './hooks/codex.json', mcpServers: './.mcp.codex.json' },
};
for (const [file, manifest] of Object.entries(manifests)) emit(file, manifest);
emit('.mcp.codex.json', { mcpServers: { Estelle: server } });
emit('.mcp.claude.json', { mcpServers: { Estelle: { type: 'http', url: server.url,
  headers: { Authorization: 'Bearer ${ESTELLE_API_KEY}' } } } });

const command = (host, variable) => `node "\${${variable}}/runtime/cli.mjs" hook ${host}`;
const commonEvents = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStart',
  'SubagentStop', 'PreCompact', 'SessionEnd', 'PreToolUse'];
function hooksFor(host, variable, events) {
  return { hooks: Object.fromEntries(events.map(event => [event, [{ hooks: [{ type: 'command',
    command: command(host, variable), timeout: ['SessionEnd', 'Interrupt'].includes(event) ? 3 : 20,
  }] }]])) };
}
emit('hooks/claude.json', hooksFor('claude-code', 'CLAUDE_PLUGIN_ROOT', commonEvents));
emit('hooks/codex.json', hooksFor('codex', 'PLUGIN_ROOT', [...commonEvents, 'PostCompact', 'Interrupt',
  'PreModelRequest', 'PostModelRequest']));
emit('kimi.plugin.json', { name: 'estelle', version, description, skills: ['./skills'],
  commands: ['./commands'], sessionStart: { skill: 'estelle' },
  mcpServers: { Estelle: { transport: 'http', url: server.url, bearerTokenEnvVar: 'ESTELLE_API_KEY' } },
  hooks: [...commonEvents, 'PostCompact', 'Interrupt', 'SessionHeartbeat', 'PostToolUseFailure']
    .map(event => ({ event, command: command('kimi', 'KIMI_PLUGIN_ROOT'), timeout: ['SessionEnd', 'Interrupt'].includes(event) ? 3 : 20 })),
});
const marketplace = { name: 'estelle-plugins', owner: { name: 'Fate Labs' },
  plugins: [{ name: 'estelle', source: './plugins/estelle', description, version }] };
emit('.claude-plugin/marketplace.json', marketplace);
emit('.grok-plugin/marketplace.json', { name: 'estelle-plugins', plugins: [{ name: 'estelle', source: './plugins/grok' }] });
emit('plugins/grok/plugin.json', { name: 'estelle', version, description, skills: './skills',
  commands: './commands', hooks: './hooks/hooks.json', mcpServers: './.mcp.json' });
emit('plugins/grok/.mcp.json', { mcpServers: { Estelle: server } });
emit('plugins/grok/hooks/hooks.json', hooksFor('grok', 'GROK_PLUGIN_ROOT', commonEvents));

const ASSETS = ['runtime', 'adapters', 'skills', 'agents', 'commands', 'docs', 'instructions.md', 'README.md', 'LICENSE', 'NOTICE'];
const NATIVE = Object.keys(manifests).concat(['.mcp.codex.json', '.mcp.claude.json', 'hooks/claude.json', 'hooks/codex.json', 'kimi.plugin.json']);
async function inventory(directory, prefix = '') {
  const output = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Bundle symlinks are forbidden');
    if (entry.isDirectory()) for (const pair of await inventory(path, relative)) output.set(...pair);
    else if (entry.isFile()) output.set(relative, createHash('sha256').update(await readFile(path)).digest('hex'));
  }
  return output;
}
for (const [file, content] of generated) {
  if (check) {
    if (await readFile(join(root, file), 'utf8') !== content) throw new Error(`Generated file differs: ${file}`);
  } else {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), content);
  }
}
for (const host of ['estelle', 'grok']) {
  const destination = join(root, 'plugins', host);
  for (const asset of ASSETS) {
    const original = join(root, asset);
    const target = join(destination, asset);
    if (!check) { await rm(target, { recursive: true, force: true }); await cp(original, target, { recursive: true }); }
    else {
      const sourceRows = (await import('node:fs')).statSync(original).isDirectory()
        ? await inventory(original) : new Map([['file', createHash('sha256').update(await readFile(original)).digest('hex')]]);
      const targetRows = (await import('node:fs')).statSync(target).isDirectory()
        ? await inventory(target) : new Map([['file', createHash('sha256').update(await readFile(target)).digest('hex')]]);
      if (JSON.stringify([...sourceRows].sort()) !== JSON.stringify([...targetRows].sort())) throw new Error(`Bundle differs: ${host}/${asset}`);
    }
  }
  if (host !== 'estelle') continue;
  for (const file of NATIVE) {
    const target = join(destination, file);
    if (!check) { await mkdir(join(target, '..'), { recursive: true }); await cp(join(root, file), target); }
    else if (await readFile(target, 'utf8') !== generated.get(file)) throw new Error(`Bundle manifest differs: ${file}`);
  }
}
console.log(`Estelle plugins ${version}: ${check ? 'checked' : 'built'}`);
