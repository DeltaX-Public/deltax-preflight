import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { InputError, preflight, decisionHash, policyHash } from '../../src/preflight.mjs';

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

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
    description: 'Check a decision proposal against separate policy and evidence documents using the local '
      + 'Preflight v2 validator. Returns the unchanged result, receipt and optional local handoff. '
      + 'PASS_SINGLE, REFUSE, EVIDENCE_REQUIRED and SELECTION_REQUIRED are normal results; none authorizes execution. '
      + 'Caller-supplied facts and policy are not independently verified.',
    inputSchema: inputs({
      decision: { description: 'Preflight v2 decision JSON document; the core validator checks its fields.' },
      policy: { description: 'Preflight v2 policy JSON document from the workflow owner.' },
      evidence: { description: 'Preflight v2 evidence JSON document, bound to the exact decision_hash.' }
    }),
    annotations
  }, resultHandler(({ decision, policy, evidence }) => preflight(decision, policy, evidence)));

  server.registerTool('preflight_hash_decision', {
    description: 'Validate a Preflight v2 decision and compute its canonical SHA-256 decision_hash for '
      + 'binding separately obtained evidence. A hash does not authenticate facts or grant authority.',
    inputSchema: inputs({ decision: { description: 'Preflight v2 decision JSON document.' } }),
    annotations
  }, resultHandler(({ decision }) => ({ decision_hash: decisionHash(decision) })));

  server.registerTool('preflight_hash_policy', {
    description: 'Validate a Preflight v2 policy and compute its canonical SHA-256 policy_hash. '
      + 'A hash is only a trusted pin when its expected value is controlled outside the proposal.',
    inputSchema: inputs({ policy: { description: 'Preflight v2 policy JSON document.' } }),
    annotations
  }, resultHandler(({ policy }) => ({ policy_hash: policyHash(policy) })));

  return server;
}
