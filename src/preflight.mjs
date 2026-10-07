import { createHash } from 'node:crypto';

const VERSION = '2';
const MAX_CANDIDATES = 100;
const MAX_CONSTRAINTS = 100;
const OPERATORS = new Set(['eq', 'in', 'lte', 'gte', 'exists']);

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function scalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function scalarType(value) {
  return value === null ? 'null' : typeof value;
}

function assert(condition, message) {
  if (!condition) throw new InputError(message);
}

function identifier(value, label) {
  assert(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value),
    `${label} must be a safe identifier of at most 200 characters`);
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) assert(allowed.includes(key), `${label} has unsupported field: ${key}`);
}

function checkJson(value, label, depth = 0) {
  assert(depth <= 32, `${label} exceeds maximum nesting depth`);
  if (scalar(value)) {
    assert(typeof value !== 'number' || Number.isFinite(value), `${label} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    assert(value.length <= 1000, `${label} has too many items`);
    value.forEach((item, index) => checkJson(item, `${label}[${index}]`, depth + 1));
    return;
  }
  assert(object(value), `${label} must contain only JSON values`);
  const keys = Object.keys(value);
  assert(keys.length <= 1000, `${label} has too many fields`);
  for (const key of keys) checkJson(value[key], `${label}.${key}`, depth + 1);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update('deltax-preflight:v2\0').update(canonical(value)).digest('hex');
}

function validateCommon(value, kind) {
  assert(object(value), `${kind} must be a JSON object`);
  checkJson(value, kind);
  assert(value.schema_version === VERSION, `${kind}.schema_version must be "${VERSION}"`);
  assert(value.kind === kind, `${kind}.kind must be "${kind}"`);
}

export function validateDecision(decision) {
  validateCommon(decision, 'decision');
  onlyKeys(decision, ['schema_version', 'kind', 'decision_id', 'context', 'candidates'], 'decision');
  identifier(decision.decision_id, 'decision_id');
  assert(object(decision.context), 'decision.context must be a JSON object');
  assert(Array.isArray(decision.candidates) && decision.candidates.length >= 1 && decision.candidates.length <= MAX_CANDIDATES,
    `decision.candidates must contain 1 to ${MAX_CANDIDATES} items`);
  const ids = new Set();
  for (const [index, candidate] of decision.candidates.entries()) {
    const label = `decision.candidates[${index}]`;
    assert(object(candidate), `${label} must be an object`);
    onlyKeys(candidate, ['id', 'payload'], label);
    identifier(candidate.id, `${label}.id`);
    assert(!ids.has(candidate.id), `duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    assert(object(candidate.payload), `${label}.payload must be a JSON object`);
  }
  return decision;
}

export function validatePolicy(policy) {
  validateCommon(policy, 'policy');
  onlyKeys(policy, ['schema_version', 'kind', 'policy_id', 'constraints'], 'policy');
  identifier(policy.policy_id, 'policy_id');
  assert(Array.isArray(policy.constraints) && policy.constraints.length >= 1 && policy.constraints.length <= MAX_CONSTRAINTS,
    `policy.constraints must contain 1 to ${MAX_CONSTRAINTS} items`);
  const ids = new Set();
  for (const [index, rule] of policy.constraints.entries()) {
    const label = `policy.constraints[${index}]`;
    assert(object(rule), `${label} must be an object`);
    onlyKeys(rule, ['id', 'source', 'path', 'op', 'value'], label);
    identifier(rule.id, `${label}.id`);
    assert(!ids.has(rule.id), `duplicate constraint id: ${rule.id}`);
    ids.add(rule.id);
    assert(rule.source === 'candidate' || rule.source === 'context', `${label}.source must be candidate or context`);
    assert(typeof rule.path === 'string' && rule.path.startsWith('/') && !/~(?![01])/.test(rule.path),
      `${label}.path must be a JSON Pointer`);
    assert(OPERATORS.has(rule.op), `${label}.op is unsupported`);
    if (rule.op === 'exists') assert(!Object.hasOwn(rule, 'value'), `${label}.value is not used by exists`);
    else {
      assert(Object.hasOwn(rule, 'value'), `${label}.value is required`);
      if (rule.op === 'in') assert(Array.isArray(rule.value) && rule.value.length > 0 && rule.value.every(scalar),
        `${label}.value must be a nonempty array of scalar values`);
      else if (rule.op === 'lte' || rule.op === 'gte') assert(typeof rule.value === 'number',
        `${label}.value must be a number`);
      else assert(scalar(rule.value), `${label}.value must be scalar`);
    }
  }
  return policy;
}

export function validateEvidence(evidence) {
  validateCommon(evidence, 'evidence');
  onlyKeys(evidence, ['schema_version', 'kind', 'evidence_id', 'source', 'decision_hash', 'context', 'candidates'], 'evidence');
  identifier(evidence.evidence_id, 'evidence_id');
  identifier(evidence.source, 'evidence.source');
  assert(typeof evidence.decision_hash === 'string' && /^[a-f0-9]{64}$/.test(evidence.decision_hash),
    'evidence.decision_hash must be a lowercase SHA-256 hash');
  assert(object(evidence.context), 'evidence.context must be a JSON object');
  assert(Array.isArray(evidence.candidates) && evidence.candidates.length <= MAX_CANDIDATES,
    `evidence.candidates must contain at most ${MAX_CANDIDATES} items`);
  const ids = new Set();
  for (const [index, item] of evidence.candidates.entries()) {
    const label = `evidence.candidates[${index}]`;
    assert(object(item), `${label} must be an object`);
    onlyKeys(item, ['id', 'facts'], label);
    identifier(item.id, `${label}.id`);
    assert(!ids.has(item.id), `duplicate evidence candidate id: ${item.id}`);
    ids.add(item.id);
    assert(object(item.facts), `${label}.facts must be a JSON object`);
  }
  return evidence;
}

export function policyHash(policy) {
  validatePolicy(policy);
  return hash(policy);
}

export function decisionHash(decision) {
  validateDecision(decision);
  return hash(decision);
}

function pointer(value, path) {
  let current = value;
  for (const token of path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if ((object(current) || Array.isArray(current)) && Object.hasOwn(current, token)) current = current[token];
    else return { found: false };
  }
  return { found: true, value: current };
}

function evaluateRule(rule, facts, context) {
  const observed = pointer(rule.source === 'candidate' ? facts : context, rule.path);
  if (!observed.found) return { outcome: 'unknown', reason: 'MISSING_EVIDENCE' };
  if (rule.op === 'exists') return { outcome: 'pass' };
  const actual = observed.value;
  if (!scalar(actual) || ((rule.op === 'lte' || rule.op === 'gte') && typeof actual !== 'number'))
    return { outcome: 'unknown', reason: 'INVALID_EVIDENCE_TYPE' };
  if (rule.op === 'eq' && scalarType(actual) !== scalarType(rule.value))
    return { outcome: 'unknown', reason: 'INVALID_EVIDENCE_TYPE' };
  if (rule.op === 'in' && !rule.value.some(item => scalarType(item) === scalarType(actual)))
    return { outcome: 'unknown', reason: 'INVALID_EVIDENCE_TYPE' };
  const pass = rule.op === 'eq' ? actual === rule.value
    : rule.op === 'in' ? rule.value.some(item => actual === item)
    : rule.op === 'lte' ? actual <= rule.value
    : actual >= rule.value;
  return pass ? { outcome: 'pass' } : { outcome: 'fail', reason: 'CONSTRAINT_VIOLATION' };
}

export function preflight(decisionInput, policyInput, evidenceInput) {
  validateDecision(decisionInput);
  validatePolicy(policyInput);
  validateEvidence(evidenceInput);
  const decision = structuredClone(decisionInput);
  const policy = structuredClone(policyInput);
  const evidence = structuredClone(evidenceInput);
  assert(evidence.decision_hash === hash(decision), 'evidence does not match this decision proposal');
  const decisionIds = new Set(decision.candidates.map(candidate => candidate.id));
  for (const item of evidence.candidates)
    assert(decisionIds.has(item.id), `evidence refers to unknown candidate: ${item.id}`);
  const evidenceById = new Map(evidence.candidates.map(item => [item.id, item.facts]));
  const candidates = decision.candidates.map(candidate => {
    const facts = evidenceById.get(candidate.id) ?? {};
    const checks = policy.constraints.map(rule => ({
      constraint_id: rule.id,
      ...evaluateRule(rule, facts, evidence.context)
    }));
    const verdict = checks.some(check => check.outcome === 'fail') ? 'rejected'
      : checks.some(check => check.outcome === 'unknown') ? 'unproven'
      : 'admissible';
    return { id: candidate.id, verdict, checks };
  });
  const admissibleIds = candidates.filter(candidate => candidate.verdict === 'admissible').map(candidate => candidate.id);
  const unproven = candidates.filter(candidate => candidate.verdict === 'unproven').length;
  const status = unproven > 0 ? 'EVIDENCE_REQUIRED'
    : admissibleIds.length === 0 ? 'REFUSE'
    : admissibleIds.length === 1 ? 'PASS_SINGLE'
    : 'SELECTION_REQUIRED';
  const result = {
    schema_version: VERSION,
    decision_id: decision.decision_id,
    policy_id: policy.policy_id,
    evidence_id: evidence.evidence_id,
    status,
    counts: {
      received: candidates.length,
      admissible: admissibleIds.length,
      rejected: candidates.filter(candidate => candidate.verdict === 'rejected').length,
      unproven
    },
    admissible_candidate_ids: admissibleIds,
    candidates
  };
  result.receipt = {
    algorithm: 'sha256',
    decision_hash: hash(decision),
    policy_hash: hash(policy),
    evidence_hash: hash(evidence),
    result_hash: hash(result)
  };
  const handoff = status === 'SELECTION_REQUIRED' ? {
    schema_version: VERSION,
    kind: 'deltax-preflight-evaluate-handoff',
    decision_id: decision.decision_id,
    original_decision: decision,
    policy,
    evidence,
    admissible_candidates: decision.candidates.filter(candidate => admissibleIds.includes(candidate.id)),
    admissible_candidate_ids: admissibleIds,
    validation_receipt: result.receipt
  } : null;
  return { result, handoff };
}
