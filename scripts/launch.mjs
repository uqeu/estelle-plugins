#!/usr/bin/env node
// Optional migration launcher: reuse ONE stored Estelle credential without installing its CLI.
import { spawn } from 'node:child_process';
import { launchCredential } from '../runtime/auth.mjs';

const [host, ...args] = process.argv.slice(2);
if (!['claude', 'codex', 'kimi', 'grok'].includes(host)) {
  console.error('Usage: node scripts/launch.mjs <claude|codex|kimi|grok> [host arguments]');
  process.exitCode = 1;
} else {
  const key = await launchCredential().catch(() => null);
  if (!key || /[\r\n]/.test(key)) {
    console.error('Set ESTELLE_API_KEY in your environment, then start the agent again.');
    process.exitCode = 1;
  } else {
    const child = spawn(host, args, { stdio: 'inherit', env: { ...process.env, ESTELLE_API_KEY: key } });
    child.once('error', () => { console.error(`Could not start ${host}. Check that it is installed.`); process.exitCode = 1; });
    child.once('exit', code => { process.exitCode = code ?? 1; });
  }
}
