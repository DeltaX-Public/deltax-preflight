import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { InputError, preflight } from './preflight.mjs';

const PROFILE_ID = 'deltax-hosted-bounded-review-evaluation-v1';
const API_VERSION = '2026-09-16.beta2';
const REVIEW_CLASSES = new Set(['analyze', 'compare', 'draft', 'validate']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,63}$/;
const CONTEXT_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REASONS = new Set([
  'candidate_selected_within_bounded_evaluation', 'no_submitted_candidate_passed_all_gates',
  'all_submitted_candidates_shadow_only', 'insufficient_bounded_support',
  'identity_or_authority_gate_closed', 'resource_or_trace_gate_closed', 'policy_conflict'
]);
const EVIDENCE_LABELS = new Set([
  'operator_reported', 'contract_validated', 'runtime_observed', 'inferred', 'unresolved'
]);
const FORBIDDEN_KEYS = new Set([
  'tenant', 'tenant_id', 'principal', 'principal_id', 'hook', 'hook_id', 'descriptor',
  'domain', 'domain_id', 'mode', 'amount', 'price', 'quote', 'quote_id', 'payer',
  'network', 'asset', 'facilitator', 'payee', 'entitlement', 'commercial_terms',
  'policy', 'authority', 'release', 'payment', 'payment_required', 'payment_signature',
  'payment_response', 'payment_identifier', 'authorization', 'credential',
  'credentials', 'secret', 'token', 'password', 'url', 'uri', 'callback', 'webhook',
  'file', 'path', 'command', 'script'
]);
const FORBIDDEN_TOKENS = new Set([...FORBIDDEN_KEYS].map(key => key.replace(/[^a-z0-9]/g, '')));
const SECRET_TEXT = [
  /\bPAYMENT-SIGNATURE\s*:/i, /\bAuthorization\s*:/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i, /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/
];
const AUTHORITY_FIELDS = [
  'selected_is_executed', 'selected_is_correct_or_safe',
  'response_authorizes_downstream_action', 'response_is_professional_advice',
  'trace_is_certification_or_legal_non_repudiation'
];

function requireCondition(condition, message) {
  if (!condition) throw new InputError(message);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
  return plainObject(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function validTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validateSuccess(response) {
  requireCondition(exactKeys(response, [
    'request_id', 'api_version', 'profile_id', 'outcome', 'selected_candidate_id',
    'reason_codes', 'trace', 'commercial_receipt', 'authority'
  ]), 'Evaluate response fields do not match the success contract');
  requireCondition(UUID.test(response.request_id) && response.api_version === API_VERSION
    && response.profile_id === PROFILE_ID, 'Evaluate response contract identity mismatch');
  requireCondition(response.outcome === 'selected' || response.outcome === 'governed_noop_refusal',
    'unsupported Evaluate outcome');
  requireCondition(Array.isArray(response.reason_codes) && response.reason_codes.length >= 1
    && response.reason_codes.length <= 16 && new Set(response.reason_codes).size === response.reason_codes.length
    && response.reason_codes.every(reason => REASONS.has(reason)), 'Evaluate reason codes are invalid');
  requireCondition(exactKeys(response.authority, AUTHORITY_FIELDS)
    && AUTHORITY_FIELDS.every(field => response.authority[field] === false),
  'Evaluate response cannot grant downstream authority');
  const trace = response.trace;
  requireCondition(exactKeys(trace, [
    'trace_id', 'request_digest', 'candidate_field_digest', 'release_set_digest',
    'policy_digest', 'lambda_decisions', 'evidence_labels',
    'submitted_candidate_executed', 'external_effect', 'learning_applied',
    'operator_reported_context_verified', 'committed_at'
  ]) && UUID.test(trace.trace_id) && validTimestamp(trace.committed_at),
  'Evaluate trace fields are invalid');
  requireCondition(['request_digest', 'candidate_field_digest', 'release_set_digest', 'policy_digest']
    .every(field => HASH.test(trace[field])), 'Evaluate trace digests are invalid');
  requireCondition(Array.isArray(trace.lambda_decisions) && trace.lambda_decisions.length === 12
    && trace.lambda_decisions.every((gate, index) => exactKeys(gate, ['gate_id', 'disposition', 'reason_code'])
      && gate.gate_id === `HES-G${String(index + 1).padStart(2, '0')}`
      && ['pass', 'fail'].includes(gate.disposition)
      && typeof gate.reason_code === 'string' && /^[a-z0-9_]{1,96}$/.test(gate.reason_code)),
  'Evaluate gate trace is invalid');
  requireCondition(Array.isArray(trace.evidence_labels) && trace.evidence_labels.length >= 1
    && trace.evidence_labels.length <= 8 && new Set(trace.evidence_labels).size === trace.evidence_labels.length
    && trace.evidence_labels.every(label => EVIDENCE_LABELS.has(label)),
  'Evaluate evidence labels are invalid');
  requireCondition(trace.external_effect === false && trace.submitted_candidate_executed === false
    && trace.learning_applied === false && trace.operator_reported_context_verified === false,
  'Evaluate trace effect state is invalid');
  const receipt = response.commercial_receipt;
  requireCondition(exactKeys(receipt, [
    'receipt_id', 'receipt_sha256', 'commercial_binding_sha256', 'mode', 'committed_at'
  ]) && UUID.test(receipt.receipt_id) && HASH.test(receipt.receipt_sha256)
    && HASH.test(receipt.commercial_binding_sha256) && receipt.mode === 'free_beta'
    && receipt.committed_at === trace.committed_at, 'Evaluate receipt is invalid');
}

function verifiedHandoff(handoff) {
  requireCondition(plainObject(handoff) && handoff.schema_version === '2'
    && handoff.kind === 'deltax-preflight-evaluate-handoff', 'invalid Preflight handoff');
  const derived = preflight(handoff.original_decision, handoff.policy, handoff.evidence);
  requireCondition(derived.result.status === 'SELECTION_REQUIRED', 'handoff has no unresolved selection');
  requireCondition(isDeepStrictEqual(handoff.validation_receipt, derived.result.receipt)
    && isDeepStrictEqual(handoff.admissible_candidate_ids, derived.handoff.admissible_candidate_ids)
    && isDeepStrictEqual(handoff.admissible_candidates, derived.handoff.admissible_candidates),
  'handoff differs from its validated inputs');
  return derived;
}

function validateContext(context) {
  requireCondition(plainObject(context) && Object.keys(context).length <= 16,
    'Evaluate context must contain at most 16 scalar fields');
  for (const [key, value] of Object.entries(context)) {
    const normalized = key.toLowerCase().replace(/[-.]/g, '_');
    const token = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    requireCondition(CONTEXT_KEY.test(key) && !FORBIDDEN_KEYS.has(normalized)
      && !FORBIDDEN_TOKENS.has(token), `Evaluate context key is unsupported: ${key}`);
    requireCondition(value === null || typeof value === 'boolean'
      || (typeof value === 'string' && value.length <= 256)
      || (typeof value === 'number' && Number.isFinite(value)
        && value >= -1_000_000_000 && value <= 1_000_000_000),
    `Evaluate context value is unsupported: ${key}`);
  }
}

export function buildEvaluateRequest(handoff, { objective, context = {} } = {}) {
  const derived = verifiedHandoff(handoff);
  requireCondition(typeof objective === 'string' && objective.length >= 1 && objective.length <= 1024,
    'Evaluate objective must contain 1 to 1024 characters');
  validateContext(context);
  requireCondition(derived.handoff.admissible_candidates.length <= 8,
    'Evaluate accepts at most eight candidates');
  const candidates = derived.handoff.admissible_candidates.map(candidate => {
    const payload = candidate.payload;
    requireCondition(ID.test(candidate.id) && candidate.id !== 'governed_noop_refusal',
      `candidate ID is outside the Evaluate contract: ${candidate.id}`);
    requireCondition(REVIEW_CLASSES.has(payload.semantic_class),
      `candidate is not a bounded selectable review step: ${candidate.id}`);
    requireCondition(typeof payload.description === 'string'
      && payload.description.length >= 1 && payload.description.length <= 512,
    `candidate description is outside the Evaluate contract: ${candidate.id}`);
    requireCondition(typeof payload.operator_reported_support === 'number'
      && Number.isFinite(payload.operator_reported_support)
      && payload.operator_reported_support >= 0 && payload.operator_reported_support <= 1,
    `candidate support is outside the Evaluate contract: ${candidate.id}`);
    return {
      candidate_id: candidate.id,
      semantic_class: payload.semantic_class,
      description: payload.description,
      operator_reported_support: payload.operator_reported_support
    };
  });
  const request = { profile_id: PROFILE_ID, objective, context: structuredClone(context), candidates };
  requireCondition(!SECRET_TEXT.some(pattern => pattern.test(JSON.stringify(request))),
    'Evaluate request contains secret-bearing text');
  requireCondition(Buffer.byteLength(JSON.stringify(request), 'utf8') <= 32_768,
    'Evaluate request exceeds 32768 bytes');
  return request;
}

export function reconcileEvaluateResponse(handoff, request, response) {
  const derived = verifiedHandoff(handoff);
  requireCondition(plainObject(request), 'invalid Evaluate request');
  requireCondition(isDeepStrictEqual(request, buildEvaluateRequest(handoff, {
    objective: request.objective, context: request.context
  })), 'Evaluate request differs from the admissible projection');
  const ids = derived.result.admissible_candidate_ids;
  validateSuccess(response);
  if (response.outcome === 'selected')
    requireCondition(ids.includes(response.selected_candidate_id), 'Evaluate selected a nonadmissible candidate');
  else requireCondition(response.selected_candidate_id === null, 'refusal must not select a candidate');
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  return {
    schema_version: '1',
    kind: 'preflight-evaluate-record',
    decision_id: derived.result.decision_id,
    proposed_candidate_ids: derived.result.candidates.map(candidate => candidate.id),
    admissible_candidate_ids: ids,
    preflight_receipt: derived.result.receipt,
    evaluate_request_sha256: requestHash,
    evaluate_outcome: response.outcome,
    selected_candidate_id: response.selected_candidate_id,
    evaluate_trace_id: response.trace.trace_id,
    evaluate_receipt_sha256: response.commercial_receipt.receipt_sha256,
    selection_is_execution: false
  };
}
