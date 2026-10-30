import { redact } from './redact.mjs';

const FILE_WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'write_file', 'replace']);
export const toolBaseName = name => typeof name === 'string' ? name.split(/[.:]/).at(-1) : '';
export const mutatingTool = name => FILE_WRITES.has(toolBaseName(name));

function credentialIn(value) {
  const pending = [{ value, depth: 0 }];
  const MAX_NODES = 10_000;
  const MAX_DEPTH = 24;
  for (let visited = 0; pending.length && visited < MAX_NODES; visited++) {
    const item = pending.pop();
    if (typeof item.value === 'string') {
      const text = item.value.replaceAll('\0', '');
      if (redact(text) !== text) return true;
    } else if (item.value && typeof item.value === 'object' && item.depth < MAX_DEPTH) {
      const values = Object.values(item.value);
      if (values.length > MAX_NODES - pending.length) return null;
      for (const child of values) pending.push({ value: child, depth: item.depth + 1 });
    } else if (item.value && typeof item.value === 'object') {
      return null;
    }
  }
  if (pending.length) return null;
  // Also catch labels represented as actual JSON properties, after raw source strings are checked.
  const encoded = JSON.stringify(value || {});
  return redact(encoded) !== encoded;
}

/** Local credential-pattern protection only. No grounding API call or automatic edit gate. */
export function protectWrite(normalized) {
  if (normalized.event !== 'PreToolUse' || !mutatingTool(normalized.toolName)) return null;
  const found = credentialIn(normalized.toolInput);
  if (found === null) return { unscanned: true };
  if (!found) return null;
  const reason = 'Estelle found a credential-shaped value in this file edit. Use an environment variable or secret store instead of writing the value into source.';
  return { hookSpecificOutput: {
    ...(normalized.host === 'grok' ? {} : { hookEventName: 'PreToolUse' }),
    permissionDecision: 'deny', permissionDecisionReason: reason,
  } };
}
