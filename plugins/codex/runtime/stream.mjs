// Port of the public Estelle CLI transcript transport. No hosted backend implementation.
import { open, mkdir, stat, readFile, writeFile, rename, unlink, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { cap, sanitize } from './redact.mjs';
import { timelineIdentity } from './identity.mjs';
import { normalizeKimiRecord } from './kimi-history.mjs';

export const LIMITS = Object.freeze({
  readBytes: 8_000_000, skipBytes: 256_000_000, batchEvents: 50, batchBytes: 2_000_000,
  claudeEvents: 200, codexEvents: 1_000, codexWindows: 4, lines: 10_000,
  spoolBytes: 64 * 1024 * 1024, spoolFiles: 4096, drainFiles: 64, stateBytes: 32_000,
  messageBlocks: 100, directoryEntries: 2_000,
  subagents: 40, subagentEvents: 400,
});
const INJECTED = ['<system-reminder', '<command-', '<local-command', '<task-notification', '[SYSTEM NOTIFICATION', 'Caveat:'];
const CODEX_INJECTED = [...INJECTED, '<environment_context', '<user_instructions', '# AGENTS.md instructions', '<skill', '<turn_aborted', '<user_shell_command'];
const AGENTS = { claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex', kimi: 'kimi-code', 'kimi-code': 'kimi-code' };
const WAITING = 'waiting_for_review/input_required';
const string = value => typeof value === 'string' ? value : '';
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export const safeSession = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const event = (event_id, kind, author, at, payload) => ({ event_id, kind, author, at, payload });
const agent = id => ({ kind: 'agent', id });
const lifecycle = (id, at, state, reason) => event(id, 'lifecycle', { kind: 'system', id: 'estelle-hook' }, at, { state, reason });
const textOf = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(b => string(b.text)).filter(Boolean).join('\n') : '';
const injected = (text, prefixes) => prefixes.some(prefix => text.trimStart().startsWith(prefix));

function messageEvents(blocks, role, id, at, harness, notes, sidechain = false, child = false) {
  const out = [];
  if (blocks.length > LIMITS.messageBlocks) throw new Error('transcript message exceeds block bound; cursor retained');
  for (const [index, block] of blocks.entries()) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const key = `${id}:${index}`;
    const text = string(block.text);
    if (['text', 'input_text', 'output_text'].includes(block.type) && text.trim()) {
      if (role === 'user' && injected(text, harness === 'codex' ? CODEX_INJECTED : INJECTED)) continue;
      if (role === 'user' && !sidechain) notes.title ??= text.trim().split('\n')[0].slice(0, 90);
      out.push(event(key, role === 'user' && !sidechain ? 'customer_message' : 'agent_message',
        role === 'user' && !sidechain ? { kind: 'customer' } : agent(sidechain || child ? 'subagent' : harness), at,
        { text: cap(text), ...(sidechain ? { subagent: true } : {}) }));
    } else if (role === 'user' && ['image', 'input_image'].includes(block.type)) {
      out.push(event(key, 'artifact', { kind: 'customer' }, at, { title: 'Image you attached', media: 'image', stored: false }));
    } else if (block.type === 'tool_result') {
      out.push(event(key, 'tool_result', agent(harness), at, { call_id: block.tool_use_id ?? null, ok: block.is_error !== true, output: cap(textOf(block.content)) }));
    } else if (role === 'assistant' && block.type === 'tool_use') {
      out.push(claudeTool(block, key, at, sidechain, child));
    } else if (role === 'assistant' && block.type === 'thinking' && string(block.thinking).trim()) {
      out.push(event(key, 'thinking', agent(harness), at, { text: cap(block.thinking) }));
    }
    // Only public transcript text is transported; private/encrypted reasoning is never recovered.
  }
  if (role === 'user' && !sidechain && !child && out.some(item => item.kind === 'customer_message')) {
    out.push(lifecycle(`${id}:input`, at, 'running', 'input_received'));
  }
  return out;
}

function claudeTool(block, id, at, sidechain, child) {
  const name = string(block.name) || 'tool';
  const input = block.input ?? {};
  const who = sidechain || child ? 'subagent' : 'claude-code';
  if (child && name === 'SubagentHandback') return event(id, 'agent_message', agent(who), at, { text: cap(string(input.message)), report: true });
  if (['Write', 'Edit', 'MultiEdit'].includes(name)) {
    const edits = name === 'MultiEdit' ? input.edits ?? [] : [input];
    const diff = name === 'Write' ? string(input.content).split('\n').map(line => `+${line}`).join('\n')
      : edits.flatMap(edit => [...string(edit.old_string).split('\n').map(line => `-${line}`), ...string(edit.new_string).split('\n').map(line => `+${line}`)]).join('\n');
    return event(id, 'edit', agent(who), at, { path: string(input.file_path), diff: cap(diff), call_id: block.id ?? null });
  }
  const summary = name === 'Bash' ? `Ran ${string(input.description) || string(input.command).slice(0, 80)}` : name === 'Read' ? `Read ${string(input.file_path)}` : name;
  return event(id, 'tool_call', { kind: /mcp__estelle__/i.test(name) ? 'estelle' : 'agent', id: who }, at,
    { call_id: block.id ?? null, tool: name, summary: cap(summary), input: sanitize({ ...input, ...(input.file_path ? { path: input.file_path } : {}) }) });
}

/** Claude JSONL UUIDs and Codex rollout byte offsets remain the server's replay identity. */
export function mapClaude(entry, offset, notes = {}, child = false) {
  if (!entry || !validTime(entry.timestamp) || !string(entry.uuid)) return [];
  const { timestamp: at, uuid: id } = entry;
  if (entry.type === 'system' && entry.subtype === 'turn_duration' && !child && !entry.isSidechain) {
    return [lifecycle(`${id}:turn-end`, at, 'waiting_for_review', 'input_required')];
  }
  if (entry.type === 'attachment') return claudeAttachment(entry, notes, child);
  if (!['user', 'assistant'].includes(entry.type) || entry.isMeta || entry.isCompactSummary) return [];
  const content = entry.message?.content;
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
  const out = messageEvents(blocks, entry.type, id, at, 'claude-code', notes, entry.isSidechain === true, child);
  if (entry.type === 'assistant' && entry.message?.usage && out.length) {
    const usage = entry.message.usage;
    out[0].payload.usage = { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0,
      cache_read: usage.cache_read_input_tokens ?? 0, cache_write: usage.cache_creation_input_tokens ?? 0, model: entry.message.model ?? null };
  }
  return out;
}

function claudeAttachment(entry, notes, child) {
  const attachment = entry.attachment ?? {};
  if (attachment.type === 'queued_command') {
    const text = textOf(attachment.prompt).trim();
    if (!text || injected(text, INJECTED)) return [];
    notes.title ??= text.split('\n')[0].slice(0, 90);
    return [event(`${entry.uuid}:queued`, 'customer_message', { kind: 'customer' }, entry.timestamp, { text: cap(text) }),
      ...(child ? [] : [lifecycle(`${entry.uuid}:input`, entry.timestamp, 'running', 'input_received')])];
  }
  const hook = attachment.hookEvent || attachment.hookName;
  if (child || attachment.type !== 'hook_additional_context' || hook !== 'UserPromptSubmit') return [];
  const parts = typeof attachment.content === 'string' ? [attachment.content] : Array.isArray(attachment.content) ? attachment.content : [];
  const mine = parts.filter(part => typeof part === 'string' && /estelle/i.test(part));
  if (!mine.length) return [];
  return [event(`${entry.uuid}:estelle-context`, 'tool_result', { kind: 'estelle', id: 'estelle-hook' }, entry.timestamp,
    { source: 'estelle-hook', hook, output: cap(mine.join('\n\n')), parts: mine.length })];
}

export function mapCodex(record, offset, notes = {}) {
  if (!record || !validTime(record.timestamp)) return [];
  const at = record.timestamp;
  const id = `r${offset}`;
  const item = record.payload ?? record;
  if (record.type === 'event_msg') return ['task_complete', 'turn_aborted'].includes(item.type)
    ? [lifecycle(`${id}:turn-end`, at, 'waiting_for_review', 'input_required')] : [];
  if (record.type !== 'response_item' && record.payload) return [];
  if (item.type === 'message') {
    if (!['user', 'assistant'].includes(item.role)) return [];
    const blocks = typeof item.content === 'string' ? [{ type: 'text', text: item.content }] : Array.isArray(item.content) ? item.content : [];
    return messageEvents(blocks, item.role, id, at, 'codex', notes);
  }
  if (item.type === 'agent_message') return [event(`${id}:0`, 'agent_message', agent('subagent'), at, { text: cap(textOf(item.content)), subagent: true })];
  if (item.type === 'reasoning' && textOf(item.summary).trim()) {
    return [event(`${id}:0`, 'thinking', agent('codex'), at, { text: cap(textOf(item.summary)) })];
  }
  if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
    return [event(`${id}:0`, 'tool_result', agent('codex'), at, { call_id: item.call_id ?? null, ok: null,
      output: cap(textOf(item.output) || (item.output && typeof item.output === 'object' ? JSON.stringify(item.output) : '')) })];
  }
  if (!['function_call', 'custom_tool_call', 'local_shell_call'].includes(item.type)) return [];
  let input = { input: string(item.input) };
  if (item.type === 'function_call') {
    try { input = JSON.parse(string(item.arguments)); } catch { input = { arguments: string(item.arguments) }; }
  } else if (item.type === 'local_shell_call') input = item.action ?? {};
  const name = [item.namespace, item.name].filter(Boolean).join('.') || 'shell';
  if (name === 'apply_patch' || name.endsWith('.apply_patch')) {
    const patch = string(item.input);
    const path = patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)?.[1] ?? '';
    return [event(`${id}:0`, 'edit', agent('codex'), at, { path, diff: cap(patch), call_id: item.call_id ?? null })];
  }
  return [event(`${id}:0`, 'tool_call', { kind: /estelle/i.test(name) ? 'estelle' : 'agent', id: 'codex' }, at,
    { call_id: item.call_id ?? null, tool: name, summary: cap(`Ran ${name}`), input: sanitize(input) })];
}

/** Current and legacy Kimi journal vocabulary, retaining original byte-offset replay IDs. */
export function mapKimi(record, offset, notes = {}) {
  record = normalizeKimiRecord(record) ?? record;
  if (!record || !Number.isFinite(record.time)) return [];
  if (!Number.isFinite(new Date(record.time).getTime())) return [];
  const at = new Date(record.time).toISOString();
  const id = `r${offset}`;
  if (record.type === 'turn.ended') return [lifecycle(`${id}:turn-end`, at, 'waiting_for_review', 'input_required')];
  if (record.type !== 'context.append_message') return [];
  const message = record.message;
  if (!message || !['user', 'assistant', 'tool'].includes(message.role)) return [];
  if (message.role === 'tool') return [event(`${id}:0`, 'tool_result', agent('kimi-code'), at,
    { call_id: message.toolCallId ?? null, ok: typeof message.isError === 'boolean' ? !message.isError : null, output: cap(textOf(message.content)) })];
  const blocks = Array.isArray(message.content) ? message.content.map(block => block?.type === 'image_url' ? { type: 'input_image' } : block) : [];
  const out = messageEvents(blocks, message.role, id, at, 'kimi-code', notes);
  const calls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  if (calls.length > LIMITS.messageBlocks) throw new Error('Kimi tool-call record exceeds block bound; cursor retained');
  for (const [index, call] of calls.entries()) {
    if (!call || typeof call !== 'object') continue;
    const name = string(call.name) || string(call.function?.name);
    let input;
    try { input = JSON.parse(string(call.arguments ?? call.function?.arguments)); } catch { input = { arguments: string(call.arguments) }; }
    out.push(event(`${id}:tool-${index}`, 'tool_call', { kind: /estelle/i.test(name) ? 'estelle' : 'agent', id: 'kimi-code' }, at,
      { call_id: call.id ?? null, tool: name || 'tool', summary: cap(`Ran ${name || 'tool'}`), input: sanitize(input) }));
  }
  return out;
}

async function readJson(path, fallback, max = LIMITS.stateBytes) {
  let handle;
  try {
    handle = await open(path, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.size > max) throw new Error('state file exceeds bound');
    const buffer = Buffer.alloc(info.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > info.size) throw new Error('state file exceeds bound');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error('stream state is unreadable or invalid', { cause: error });
  } finally { await handle?.close(); }
}

async function saveJson(path, value) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function listBounded(dir, bound) {
  const files = [];
  let entries = 0;
  try {
    for await (const entry of await opendir(dir)) {
      if (++entries > bound + 1) throw new Error('stream directory entry bound reached');
      if (entry.isFile() && entry.name.endsWith('.json')) files.push(join(dir, entry.name));
      if (files.length > bound) throw new Error('spool file bound reached');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return files.sort();
}

function retryable(error) {
  return !Number.isInteger(error.status) || error.status >= 500 || [401, 403, 408, 429].includes(error.status);
}

async function sendBatch(request, session, events) {
  let pending = events;
  let dropped = 0;
  const bound = events.length + 1;
  for (let attempt = 0; attempt < bound; attempt++) {
    if (!pending.length) return { dropped };
    try { await request('/session/events', { session_id: session, events: pending }); return { dropped }; }
    catch (error) {
      const index = error.status === 400 ? /^event (\d+):/.exec(string(error.message))?.[1] : undefined;
      if (index === undefined || Number(index) >= pending.length) throw error;
      pending = pending.filter((_, i) => i !== Number(index));
      dropped++;
    }
  }
  throw new Error('event isolation exhausted its bound');
}

async function spoolBatch(dir, session, events) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const body = JSON.stringify({ session_id: session, events });
  const hash = createHash('sha256').update(body).digest('hex');
  const path = join(dir, `${hash}.json`);
  try { await stat(path); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = await listBounded(dir, LIMITS.spoolFiles);
  let bytes = Buffer.byteLength(body);
  for (const file of files) bytes += (await stat(file)).size;
  if (files.length >= LIMITS.spoolFiles || bytes > LIMITS.spoolBytes) throw new Error('stream spool is full; transcript cursor retained');
  await saveJson(path, { session_id: session, events });
}

async function drainSpool(dir, request) {
  let replayed = 0;
  const files = (await listBounded(dir, LIMITS.spoolFiles)).slice(0, LIMITS.drainFiles);
  for (const file of files) {
    const record = await readJson(file, null, LIMITS.batchBytes + 2048);
    if (!record || !Array.isArray(record.events) || !string(record.session_id)) throw new Error('invalid stream spool record');
    try {
      await sendBatch(request, record.session_id, record.events);
      await unlink(file);
      replayed += record.events.length;
    } catch (error) { if (retryable(error)) break; }
  }
  return replayed;
}

async function readWindow(file, offset) {
  const handle = await open(file, 'r');
  try {
    const length = (await handle.stat()).size;
    const start = offset > length ? 0 : offset;
    const buffer = Buffer.alloc(Math.min(LIMITS.readBytes, length - start));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const end = buffer.subarray(0, bytesRead).lastIndexOf(10) + 1;
    const oversized = end === 0 && bytesRead === LIMITS.readBytes;
    const skipTo = oversized ? await endOfLongLine(handle, start + bytesRead, length) : null;
    return { buffer: buffer.subarray(0, end), start, length, incomplete: start + end < length, oversized, skipTo };
  } finally { await handle.close(); }
}

async function endOfLongLine(handle, from, length) {
  const chunk = Buffer.alloc(1_048_576);
  const max = Math.min(length, from + LIMITS.skipBytes);
  const windows = Math.ceil((max - from) / chunk.length);
  let at = from;
  for (let pass = 0; pass < windows; pass++) {
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, max - at), at);
    if (!bytesRead) break;
    const newline = chunk.subarray(0, bytesRead).indexOf(10);
    if (newline >= 0) return at + newline + 1;
    at += bytesRead;
  }
  return null; // Never advance into a line or past a bound that did not find its newline.
}

function collectWindow(window, host, notes, remaining, child = false) {
  const events = [];
  let used = 0;
  let invalid = 0;
  let lines = 0;
  const mapper = host === 'codex' ? mapCodex : host === 'kimi-code' ? mapKimi : mapClaude;
  const buffer = window.buffer;
  for (let from = 0; from < buffer.length && lines < LIMITS.lines; lines++) {
    const end = buffer.indexOf(10, from) + 1;
    if (!end) break;
    let parsed;
    try { parsed = JSON.parse(buffer.subarray(from, end).toString('utf8')); } catch { invalid++; }
    const mapped = parsed ? mapper(parsed, window.start + from, notes, child) : [];
    if (events.length && events.length + mapped.length > remaining) break;
    events.push(...mapped);
    used = end;
    from = end;
    if (events.length >= remaining) break;
  }
  return { events, offset: window.start + used, invalid };
}

function collapse(events, last) {
  const kept = [];
  for (const item of events) {
    if (item.kind === 'lifecycle') {
      const key = `${item.payload.state}/${item.payload.reason}`;
      if (key === WAITING && last === WAITING) continue;
      last = key;
    }
    kept.push(item);
  }
  return { events: kept, last };
}

function eventBatches(events) {
  const batches = [];
  let batch = [];
  let size = 0;
  for (const item of events) {
    const bytes = Buffer.byteLength(JSON.stringify(item));
    if (bytes > LIMITS.batchBytes) throw new Error('one stream event exceeds wire bound; cursor retained');
    if (batch.length && (batch.length >= LIMITS.batchEvents || size + bytes > LIMITS.batchBytes - 512)) {
      batches.push(batch); batch = []; size = 0;
    }
    batch.push(item); size += bytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** request(path, body) must reject HTTP failures with {status,message}. No credentials are persisted here. */
export async function streamSession({ payload, host, repo, stateDir, request }) {
  const harness = AGENTS[host];
  if (!harness) return { sent: 0, unsupported: true, reason: 'transcript dialect is not verified for this host' };
  const session = payload.session_id;
  if (!safeSession(session)) throw new Error('invalid host session identity');
  if (typeof request !== 'function' || typeof stateDir !== 'string') throw new TypeError('stream request and state directory required');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const spoolDir = join(stateDir, 'spool');
  const replayed = await drainSpool(spoolDir, request);
  if (!string(payload.transcript_path)) return { sent: 0, replayed, incomplete: true, reason: 'host did not supply a transcript path' };
  const transcript = resolve(payload.transcript_path);
  const statePath = join(stateDir, `${harness}-${session}.stream.json`);
  const state = await readJson(statePath, { offset: 0, started: false, last_lifecycle: null });
  if (!Number.isSafeInteger(state.offset) || state.offset < 0) throw new Error('invalid transcript cursor');
  const timeline = timelineIdentity(host, session);
  const notes = {};
  let events = [];
  let offset = state.offset;
  let invalid = 0;
  let skipped = 0;
  let incomplete = false;
  const windows = harness === 'codex' ? LIMITS.codexWindows : 1;
  const budget = harness === 'codex' ? LIMITS.codexEvents : LIMITS.claudeEvents;
  for (let pass = 0; pass < windows && events.length < budget; pass++) {
    const window = await readWindow(transcript, offset);
    if (window.oversized) {
      if (window.skipTo === null) return { sent: 0, replayed, incomplete: true, reason: 'unterminated transcript line exceeds read bound; cursor retained' };
      offset = window.skipTo; skipped++; incomplete = offset < window.length;
      continue;
    }
    const collected = collectWindow(window, harness, notes, budget - events.length);
    events.push(...collected.events); invalid += collected.invalid;
    incomplete = collected.offset < window.length;
    if (collected.offset === offset) break;
    offset = collected.offset;
    if (!incomplete) break;
  }
  const first = events[0]?.at;
  const started = state.started || Boolean(first);
  if (!state.started && first) events.unshift(event(`${timeline}:started`, 'lifecycle', { kind: 'system', id: 'estelle-hook' }, first,
    { state: 'running', reason: 'started', title: cap(notes.title || `${harness} session`), repo, origin: harness, harness }));
  // Do not announce a turn end ahead of still-unread transcript events.
  const last = events.at(-1)?.at ?? state.last_at;
  if (started && payload.hook_event_name === 'UserPromptSubmit') {
    const at = new Date(Math.max(Date.now(), validTime(last) ? Date.parse(last) : 0)).toISOString();
    events.push(lifecycle(`${timeline}:prompt:${offset}`, at, 'running', 'input_received'));
  }
  if (!incomplete && last && ['Stop', 'SessionEnd'].includes(payload.hook_event_name)) {
    const end = payload.hook_event_name === 'SessionEnd';
    events.push(lifecycle(`${timeline}:${end ? 'end' : 'stop'}:${offset}`, last, end ? 'ended' : 'waiting_for_review', end ? 'completed' : 'input_required'));
  }
  const collapsed = collapse(events, state.last_lifecycle);
  const batches = eventBatches(collapsed.events.map(item => sanitize(item)));
  let sent = 0;
  let dropped = 0;
  for (const [index, batch] of batches.entries()) {
    try { const result = await sendBatch(request, timeline, batch); dropped += result.dropped; sent += batch.length - result.dropped; }
    catch (error) {
      if (retryable(error)) {
        for (const remaining of batches.slice(index)) await spoolBatch(spoolDir, timeline, remaining);
      }
      // Spooling preserves the failed batch across transcript deletion; only server ACK advances cursor.
      await saveJson(statePath, { ...state, last_error: 'stream upload pending', invalid_lines: invalid });
      return { sent, dropped, replayed, pending: true, incomplete: true, error: 'stream upload pending; cursor retained' };
    }
  }
  await saveJson(statePath, { offset, started, last_at: events.at(-1)?.at ?? last, last_lifecycle: collapsed.last, invalid_lines: invalid, skipped_lines: skipped, last_error: null });
  return { sent, dropped, replayed, backlog: incomplete, incomplete: incomplete || harness === 'kimi-code', invalid_lines: invalid, skipped_lines: skipped, offset, session_id: timeline,
    ...(harness === 'kimi-code' ? { transcript_format: 'kimi-wire', current_format_verified: true,
      capture_scope: 'main-agent journal; stream includes recorded branch history' } : {}) };
}
