import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { InputError, preflight, decisionHash, policyHash } from '../../src/preflight.mjs';

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const digest = { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Canonical SHA-256 digest.' };
const hashOutput = key => fromJsonSchema({
  type: 'object',
  required: [key],
  additionalProperties: false,
  properties: { [key]: digest }
});
const checkOutput = fromJsonSchema({
  type: 'object',
  required: ['result', 'handoff'],
  additionalProperties: false,
  properties: {
    result: {
      type: 'object',
      description: 'The unchanged Preflight v2 validation report; it never authorizes execution.',
      required: ['status', 'counts', 'admissible_candidate_ids', 'candidates', 'receipt'],
      properties: {
        status: {
          enum: ['PASS_SINGLE', 'SELECTION_REQUIRED', 'REFUSE', 'EVIDENCE_REQUIRED'],
          description: 'One proven option, multiple proven options, none allowed, or missing evidence.'
        },
        counts: {
          type: 'object',
          required: ['received', 'admissible', 'rejected', 'unproven'],
          properties: Object.fromEntries(['received', 'admissible', 'rejected', 'unproven']
            .map(key => [key, { type: 'integer', minimum: 0 }]))
        },
        admissible_candidate_ids: { type: 'array', items: { type: 'string' } },
        candidates: { type: 'array', items: { type: 'object' } },
        receipt: {
          type: 'object',
          required: ['algorithm', 'decision_hash', 'policy_hash', 'evidence_hash', 'result_hash'],
          properties: {
            algorithm: { const: 'sha256' },
            decision_hash: digest,
            policy_hash: digest,
            evidence_hash: digest,
            result_hash: digest
          }
        }
      }
    },
    handoff: {
      type: ['object', 'null'],
      description: 'The original local handoff only for SELECTION_REQUIRED; otherwise null. It is not an API request.'
    }
  }
});

// Only validate the tool envelope here. The unchanged core owns all document validation.
function inputs(properties) {
  return fromJsonSchema({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false
  });
}

function resultHandler(operation) {
  return async args => {
    try {
      const value = operation(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(value) }],
        structuredContent: value
      };
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      return {
        isError: true,
        content: [{ type: 'text', text: error.message }]
      };
    }
  };
}

export function createPreflightServer() {
  const server = new McpServer({ name: 'deltax-preflight', version: '0.1.0' }, {
    instructions: 'Preflight checks caller-supplied policy and evidence. It does not authenticate facts, '
      + 'select candidates, execute actions, or grant authority. Keep policy and evidence under trusted '
      + 'owner control when using results in a workflow. DeltaX Evaluate is optional and is never called by this server.'
  });

  server.registerTool('preflight_check', {
    description: 'Use after concrete candidates, owner-controlled policy, and separately obtained evidence exist. '
      + 'Returns {result, handoff}: PASS_SINGLE means one proven option, SELECTION_REQUIRED means multiple, '
      + 'REFUSE means none, and EVIDENCE_REQUIRED means at least one remains unproven. Handoff is null except '
      + 'for SELECTION_REQUIRED. Invalid documents return a tool error with no partial report. This local check '
      + 'does not verify supplied facts, select or execute actions, or call DeltaX Evaluate. Use the hash tools '
      + 'to bind evidence to a decision or pin owner policy before checking.',
    inputSchema: inputs({
      decision: { description: 'Preflight v2 object with schema_version "2", a decision_id, context, and 1-100 candidates with unique IDs and payloads. Candidate claims are proposals, not proof.' },
      policy: { description: 'Owner-controlled Preflight v2 policy object with hard constraints over candidate or context evidence; keep it separate from the proposer.' },
      evidence: { description: 'Preflight v2 evidence object from an authorized fact source. Its decision_hash must match this exact decision; missing facts remain unproven.' }
    }),
    outputSchema: checkOutput,
    annotations
  }, resultHandler(({ decision, policy, evidence }) => preflight(decision, policy, evidence)));

  server.registerTool('preflight_hash_decision', {
    description: 'Use before an evidence producer binds facts to an exact proposal. Validates a Preflight v2 '
      + 'decision and returns {decision_hash}, its canonical SHA-256 digest. Invalid decisions return a tool '
      + 'error, not a hash. This hash does not authenticate facts or approve an action; use preflight_check '
      + 'when policy and evidence are ready.',
    inputSchema: inputs({ decision: { description: 'Preflight v2 object with schema_version "2", decision_id, context, and 1-100 unique candidate IDs with payloads.' } }),
    outputSchema: hashOutput('decision_hash'),
    annotations
  }, resultHandler(({ decision }) => ({ decision_hash: decisionHash(decision) })));

  server.registerTool('preflight_hash_policy', {
    description: 'Use to pin owner-controlled rules outside an untrusted proposal. Validates a Preflight v2 '
      + 'policy and returns {policy_hash}, its canonical SHA-256 digest. Invalid policies return a tool error, '
      + 'not a hash. The hash alone does not establish policy ownership; use preflight_check to evaluate candidates.',
    inputSchema: inputs({ policy: { description: 'Owner-controlled Preflight v2 object with schema_version "2", policy_id, and 1-100 hard constraints using eq, in, lte, gte, or exists.' } }),
    outputSchema: hashOutput('policy_hash'),
    annotations
  }, resultHandler(({ policy }) => ({ policy_hash: policyHash(policy) })));

  return server;
}
