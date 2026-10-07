import { createHash } from 'node:crypto';

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

function assert(condition, message) {
  if (!condition) throw new InputError(message);
}

function identifier(value, label) {
  assert(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value),
    `${label} must be a safe identifier of at most 200 characters`);
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
  return createHash('sha256').update('deltax-preflight:v1\0').update(canonical(value)).digest('hex');
}

function pointer(value, path) {
  let current = value;
  for (const token of path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if ((object(current) || Array.isArray(current)) && Object.hasOwn(current, token)) current = current[token];
    else return { found: false };
  }
  return { found: true, value: current };
}

export function validateInput(input) {
  assert(object(input), 'input must be a JSON object');
  checkJson(input, 'input');
  assert(input.schema_version === '1', 'schema_version must be "1"');
  identifier(input.decision_id, 'decision_id');
  assert(object(input.context), 'context must be a JSON object');
  assert(Array.isArray(input.candidates) && input.candidates.length >= 1 && input.candidates.length <= MAX_CANDIDATES,
    `candidates must contain 1 to ${MAX_CANDIDATES} items`);
  assert(Array.isArray(input.constraints) && input.constraints.length >= 1 && input.constraints.length <= MAX_CONSTRAINTS,
    `constraints must contain 1 to ${MAX_CONSTRAINTS} items`);

  const candidateIds = new Set();
  for (const [index, candidate] of input.candidates.entries()) {
    assert(object(candidate), `candidates[${index}] must be an object`);
    identifier(candidate.id, `candidates[${index}].id`);
    assert(!candidateIds.has(candidate.id), `duplicate candidate id: ${candidate.id}`);
    candidateIds.add(candidate.id);
    assert(object(candidate.facts), `candidates[${index}].facts must be a JSON object`);
  }

  const constraintIds = new Set();
  for (const [index, rule] of input.constraints.entries()) {
    assert(object(rule), `constraints[${index}] must be an object`);
    identifier(rule.id, `constraints[${index}].id`);
    assert(!constraintIds.has(rule.id), `duplicate constraint id: ${rule.id}`);
    constraintIds.add(rule.id);
    assert(rule.source === 'candidate' || rule.source === 'context', `constraints[${index}].source must be candidate or context`);
    assert(typeof rule.path === 'string' && rule.path.startsWith('/') && !/~(?![01])/.test(rule.path),
      `constraints[${index}].path must be a JSON Pointer`);
    assert(OPERATORS.has(rule.op), `constraints[${index}].op is unsupported`);
    if (rule.op === 'exists') {
      assert(!Object.hasOwn(rule, 'value'), `constraints[${index}].value is not used by exists`);
    } else {
      assert(Object.hasOwn(rule, 'value'), `constraints[${index}].value is required`);
      if (rule.op === 'in') assert(Array.isArray(rule.value) && rule.value.length > 0 && rule.value.every(scalar),
        `constraints[${index}].value must be a nonempty array of scalar values`);
      else if (rule.op === 'lte' || rule.op === 'gte') assert(typeof rule.value === 'number',
        `constraints[${index}].value must be a number`);
      else assert(scalar(rule.value), `constraints[${index}].value must be scalar`);
    }
  }
  return input;
}

function evaluateRule(rule, candidate, context) {
  const observed = pointer(rule.source === 'candidate' ? candidate.facts : context, rule.path);
  if (rule.op === 'exists') return observed.found
    ? { outcome: 'pass' }
    : { outcome: 'fail', reason: 'MISSING_REQUIRED_FACT' };
  if (!observed.found) return { outcome: 'unknown', reason: 'MISSING_EVIDENCE' };
  const actual = observed.value;
  if (!scalar(actual)) return { outcome: 'fail', reason: 'TYPE_MISMATCH' };
  if ((rule.op === 'lte' || rule.op === 'gte') && typeof actual !== 'number')
    return { outcome: 'fail', reason: 'TYPE_MISMATCH' };
  const pass = rule.op === 'eq' ? actual === rule.value
    : rule.op === 'in' ? rule.value.some(item => actual === item)
    : rule.op === 'lte' ? actual <= rule.value
    : actual >= rule.value;
  return pass ? { outcome: 'pass' } : { outcome: 'fail', reason: 'CONSTRAINT_VIOLATION' };
}

export function preflight(input) {
  validateInput(input);
  const decision = structuredClone(input);
  const candidates = decision.candidates.map(candidate => {
    const checks = decision.constraints.map(rule => ({
      constraint_id: rule.id,
      ...evaluateRule(rule, candidate, decision.context)
    }));
    const verdict = checks.some(check => check.outcome === 'fail') ? 'rejected'
      : checks.some(check => check.outcome === 'unknown') ? 'unproven'
      : 'admissible';
    return { id: candidate.id, verdict, checks };
  });
  const admissibleIds = candidates.filter(candidate => candidate.verdict === 'admissible').map(candidate => candidate.id);
  const status = admissibleIds.length === 0 ? 'REFUSE'
    : admissibleIds.length === 1 ? 'PASS_SINGLE'
    : 'SELECTION_REQUIRED';
  const result = {
    schema_version: '1',
    decision_id: decision.decision_id,
    status,
    counts: {
      received: candidates.length,
      admissible: admissibleIds.length,
      rejected: candidates.filter(candidate => candidate.verdict === 'rejected').length,
      unproven: candidates.filter(candidate => candidate.verdict === 'unproven').length
    },
    admissible_candidate_ids: admissibleIds,
    candidates
  };
  result.receipt = {
    algorithm: 'sha256',
    input_hash: hash(decision),
    result_hash: hash(result)
  };
  const handoff = status === 'SELECTION_REQUIRED' ? {
    schema_version: '1',
    kind: 'deltax-preflight-evaluate-handoff',
    decision_id: decision.decision_id,
    original_decision: decision,
    admissible_candidates: decision.candidates.filter(candidate => admissibleIds.includes(candidate.id)),
    admissible_candidate_ids: admissibleIds,
    validation_receipt: result.receipt
  } : null;
  return { result, handoff };
}
