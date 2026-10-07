import { InputError, decisionHash, preflight } from './preflight.mjs';

function requireValue(condition, message) {
  if (!condition) throw new InputError(message);
}

function label(value, kind) {
  requireValue(typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 200,
    `${kind} must contain 1 to 200 characters`);
  return value.trim();
}

export function runWorksheet({ objective, options, requirements, answers }) {
  const namedObjective = label(objective, 'objective');
  requireValue(Array.isArray(options) && options.length >= 1 && options.length <= 8,
    'worksheet needs 1 to 8 options');
  requireValue(Array.isArray(requirements) && requirements.length >= 1 && requirements.length <= 8,
    'worksheet needs 1 to 8 hard requirements');
  requireValue(Array.isArray(answers) && answers.length === options.length,
    'answers must match the option count');
  const optionLabels = options.map(item => label(item, 'option'));
  const requirementLabels = requirements.map(item => label(item, 'requirement'));
  requireValue(answers.every(row => Array.isArray(row) && row.length === requirements.length
    && row.every(value => ['yes', 'no', 'unknown'].includes(value))),
  'each answer must be yes, no, or unknown');
  const decision = {
    schema_version: '2', kind: 'decision', decision_id: 'interactive-worksheet',
    context: { objective: namedObjective },
    candidates: optionLabels.map((name, index) => ({
      id: `option_${index + 1}`, payload: { name }
    }))
  };
  const policy = {
    schema_version: '2', kind: 'policy', policy_id: 'interactive-hard-requirements',
    constraints: requirementLabels.map((_name, index) => ({
      id: `requirement_${index + 1}`, source: 'candidate',
      path: `/requirement_${index + 1}`, op: 'eq', value: true
    }))
  };
  const evidence = {
    schema_version: '2', kind: 'evidence', evidence_id: 'interactive-self-report',
    source: 'interactive-self-report', decision_hash: decisionHash(decision),
    context: {},
    candidates: answers.map((row, optionIndex) => ({
      id: `option_${optionIndex + 1}`,
      facts: Object.fromEntries(row.flatMap((answer, requirementIndex) =>
        answer === 'unknown' ? [] : [[`requirement_${requirementIndex + 1}`, answer === 'yes']]))
    }))
  };
  return { decision, policy, evidence, ...preflight(decision, policy, evidence),
    option_labels: optionLabels, requirement_labels: requirementLabels };
}
