import { rename, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { readJson, writeJson } from './io.mjs';

const CLAIM_ATTEMPTS = 20;
const CLAIM_RETRY_MS = 5;

export async function beginContext(path, turnId) {
  const requestId = randomUUID();
  await writeJson(path, { turnId, requestId, text: null });
  return requestId;
}

async function claim(path, retry) {
  for (let attempt = 0; attempt < (retry ? CLAIM_ATTEMPTS : 1); attempt++) {
    const claimed = `${path}.${randomUUID()}.claimed`;
    try { await rename(path, claimed); return claimed; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (retry) await setTimeout(CLAIM_RETRY_MS);
    }
  }
  return null;
}

async function restore(claimed, path) {
  // An intervening new prompt owns the path. Never replace it with an older result.
  try { await link(claimed, path); return true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; return false; }
}

export async function saveContext(path, turnId, requestId, text, degraded = false) {
  const claimed = await claim(path, true);
  if (!claimed) return false;
  try {
    const stored = await readJson(claimed);
    const matches = stored.turnId === turnId && stored.requestId === requestId;
    if (matches) await writeJson(claimed, { ...stored, text, degraded: degraded === true });
    const restored = await restore(claimed, path);
    return matches && restored;
  } finally { await unlink(claimed); }
}

export async function takeContext(path, turnId) {
  if (!turnId) return null;
  const claimed = await claim(path, false);
  if (!claimed) return null;
  try {
    const stored = await readJson(claimed);
    if (stored.turnId === turnId && typeof stored.text === 'string' && stored.text) return { text: stored.text, degraded: stored.degraded === true };
    await restore(claimed, path);
    return null;
  } finally { await unlink(claimed); }
}
