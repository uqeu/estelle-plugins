import { apiClient } from './io.mjs';
import { captureTreeArtifact } from './native-tree.mjs';
import { redact } from './redact.mjs';

const MAX_ARGUMENTS = 128;
const MAX_TASK_CHARS = 1000;
const MAX_VALUE_CHARS = 8192;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const identifier = value => typeof value === 'string' && ID.test(value) && redact(value) === value;
const REASONS = new Set(['activation_proofs_missing', 'native_stage_incomplete', 'no_new_computer_staged']);
const LAUNCH_OUTCOMES = new Set(['launched', 'attached', 'woken', 'refused', 'start-failed', 'rolled-back', 'unknown']);
const text = (value, bound) => typeof value === 'string' && value.trim() === value && value.length > 0
  && Array.from(value).length <= bound && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value);

function validate(options, paid = false) {
  if (options.consent !== true || options.replace !== true) throw new Error('native_consent_required');
  if (paid && options.provisionConsent !== true) throw new Error('native_provision_consent_required');
  if (!['claude-code', 'codex'].includes(options.harness) || !text(options.sessionId, 200)
      || !text(options.cwd, MAX_VALUE_CHARS) || !text(options.transcriptPath, MAX_VALUE_CHARS)
      || !identifier(options.roomId) || !identifier(options.launchKey) || options.launchKey.length < 8
      || !['estelle', 'provider_key', 'subscription'].includes(options.payment)
      || !text(options.model, 128) || /\s/.test(options.model) || redact(options.model) !== options.model
      || !text(options.task, MAX_TASK_CHARS)
      || redact(options.task) !== options.task) throw new Error('native_stage_arguments');
}

function matchReference(result, body, state) {
  const exact = { state, room_id: body.room_id, source_session: `${body.harness}-${body.native.session_id}`,
    harness: body.harness, payment: body.payment, model: body.model, base_commit: body.ref,
    safe_to_close_laptop: false };
  if (!result || typeof result !== 'object' || Array.isArray(result)
      || Object.entries(exact).some(([key, value]) => result[key] !== value)) throw new Error('native_receipt_mismatch');
  return exact;
}

async function prepared(options, request) {
  const facts = await request('/ade', { action: 'native_capabilities' });
  if (facts?.transport_version !== 2 || facts.tree_snapshot !== true || facts.inactive_staging !== true) {
    throw new Error('native_staging_unsupported');
  }
  const { repo, native } = await captureTreeArtifact(options);
  const body = { action: 'prepare_native', repo, ref: native.base_commit, harness: options.harness,
    room_id: options.roomId, payment: options.payment, model: options.model, task: options.task,
    launch_key: options.launchKey, native };
  const result = await request('/ade', body);
  const reference = matchReference(result, body, 'prepared');
  if (result.provisioned !== false) throw new Error('native_receipt_mismatch');
  return { body, reference: { ...reference, provisioned: false } };
}

function client() {
  // One bounded attempt. A lost paid response is not permission to start another computer.
  const deadline = Date.now() + 80_000;
  return apiClient({ timeoutMs: 80_000, deadline });
}

export async function prepareCloud(options, request) {
  validate(options);
  return (await prepared(options, request || client())).reference;
}

export async function stageCloud(options, request) {
  validate(options, true);
  request ||= client();
  const { body } = await prepared(options, request);
  const result = await request('/ade', { ...body, action: 'stage_native', provision_consent: true });
  const reference = matchReference(result, body, 'activation_blocked');
  const missingId = result.silo_id === '' && result.provisioned !== true && result.reason === 'no_new_computer_staged';
  if ((!missingId && !identifier(result.silo_id)) || result.native_command_started !== false
      || !REASONS.has(result.reason) || ![true, false, null].includes(result.provisioned)
      || (result.launch_outcome !== undefined && !LAUNCH_OUTCOMES.has(result.launch_outcome))) throw new Error('native_receipt_mismatch');
  const computer = result.computer;
  const cleanup = computer && ['pause', 'stop'].includes(computer.requested)
    ? { requested: computer.requested, verified: computer.verified === true } : null;
  const complete = result.provisioned === true && result.artifacts_verified === true && result.workspace_prepared === true
    && result.reason === 'activation_proofs_missing' && cleanup?.requested === 'pause' && cleanup.verified === true;
  return { ...reference, outcome: complete ? 'staged_inactive' : 'incomplete', silo_id: result.silo_id,
    provisioned: result.provisioned, artifacts_verified: result.artifacts_verified === true,
    workspace_prepared: result.workspace_prepared === true, native_command_started: false,
    reason: result.reason, computer: cleanup, launch_outcome: result.launch_outcome ?? null,
    safe_to_close_laptop: false };
}

export function parseStageArguments(args) {
  const names = { '--harness': 'harness', '--session': 'sessionId', '--transcript': 'transcriptPath', '--repo': 'cwd',
    '--room': 'roomId', '--payment': 'payment', '--model': 'model', '--task': 'task', '--launch-key': 'launchKey' };
  const flags = { '--consent': 'consent', '--replace': 'replace', '--provision-consent': 'provisionConsent' };
  if (!Array.isArray(args) || args.length > MAX_ARGUMENTS) throw new Error('native_stage_arguments');
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (Object.hasOwn(flags, arg) && !Object.hasOwn(options, flags[arg])) options[flags[arg]] = true;
    else if (Object.hasOwn(names, arg) && !Object.hasOwn(options, names[arg]) && text(args[i + 1], MAX_VALUE_CHARS)
        && !args[i + 1].startsWith('--')) options[names[arg]] = args[++i];
    else if (arg === '--untracked' && text(args[i + 1], 512) && !args[i + 1].startsWith('--')) {
      options.selectedUntracked ||= []; options.selectedUntracked.push(args[++i]);
    } else throw new Error('native_stage_arguments');
  }
  return options;
}
