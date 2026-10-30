// Shared public timeline identity. This is a name, never a Rooms write credential.
const HARNESSES = { claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex',
  kimi: 'kimi-code', 'kimi-code': 'kimi-code', grok: 'grok', cursor: 'cursor' };
export function canonicalHost(host) {
  const value = HARNESSES[host];
  if (!value) throw new Error('unsupported_host');
  return value;
}
export function timelineIdentity(host, session) {
  if (typeof session !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(session)) throw new Error('session_missing');
  return `${canonicalHost(host)}-${session}`;
}
