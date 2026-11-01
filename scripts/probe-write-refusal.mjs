import { apiBase, MAX_RESPONSE_BYTES } from '../runtime/io.mjs';

// These are the missing-session refusals, not an arbitrary authentication or admission error.
const VALIDATION_MESSAGES = {
  '/session/events': 'session_id must be 1-256 characters',
  '/checkpoint': "checkpoint needs a 'session_id' (string)",
};

async function boundedBody(response) {
  const chunks = [];
  let bytes = 0;
  const overflow = new Error('probe_response_bound');
  try {
    for await (const chunk of response.body || []) {
      bytes += chunk.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw overflow;
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    throw error === overflow ? overflow : new Error('probe_write_response_read');
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** No valid memory write is sent. Auth/admission/telemetry may still run before validation. */
export async function refusedWrite({ base, path, credential, fetchImpl = fetch }) {
  if (!Object.hasOwn(VALIDATION_MESSAGES, path)) throw new Error('probe_write_route');
  if (typeof credential !== 'string' || !credential || /[\r\n]/.test(credential)) {
    throw new Error('probe_write_credential');
  }
  const origin = apiBase({ ESTELLE_API_URL: base });
  let response;
  try {
    response = await fetchImpl(`${origin}${path}`, { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: '{}' });
  } catch {
    throw new Error('probe_write_transport');
  }
  const raw = await boundedBody(response);
  let result;
  try { result = JSON.parse(raw); }
  catch { throw new Error('probe_write_response_json'); }
  if (response.status !== 400 || result?.error?.code !== 400 ||
      result.error.message !== VALIDATION_MESSAGES[path]) throw new Error('probe_write_validation');
  return response.status;
}
