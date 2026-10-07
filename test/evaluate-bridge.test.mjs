import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preflight, InputError } from '../src/preflight.mjs';
import { buildEvaluateRequest, reconcileEvaluateResponse } from '../src/evaluate-bridge.mjs';

const load = async name => JSON.parse(await readFile(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
const fixture = async () => {
  const [decision, policy, evidence, response] = await Promise.all([
    load('review-decision'), load('review-policy'), load('review-evidence'),
    load('review-response.synthetic')
  ]);
  const { result, handoff } = preflight(decision, policy, evidence);
  return { result, handoff, response };
};
const options = {
  objective: 'Choose a bounded review step for a synthetic packet.',
  context: { evidence_kind: 'synthetic', external_actions_allowed: false }
};

test('bridge projects only admissible bounded review candidates', async () => {
  const { result, handoff, response } = await fixture();
  assert.equal(result.status, 'SELECTION_REQUIRED');
  const request = buildEvaluateRequest(handoff, options);
  assert.deepEqual(request.candidates.map(candidate => candidate.candidate_id),
    ['summarize_evidence', 'compare_claims']);
  assert.equal(JSON.stringify(request).includes('bounded_review'), false);
  assert.equal(JSON.stringify(request).includes('publish_report'), false);
  const record = reconcileEvaluateResponse(handoff, request, response);
  assert.equal(record.selected_candidate_id, 'summarize_evidence');
  assert.deepEqual(record.proposed_candidate_ids,
    ['summarize_evidence', 'compare_claims', 'publish_report']);
  assert.equal(record.selection_is_execution, false);
});

test('bridge refuses tampering, nonadmissible selection, and authority drift', async () => {
  const { handoff, response } = await fixture();
  const request = buildEvaluateRequest(handoff, options);
  response.selected_candidate_id = 'publish_report';
  assert.throws(() => reconcileEvaluateResponse(handoff, request, response), InputError);
  response.selected_candidate_id = 'summarize_evidence';
  response.authority.selected_is_executed = true;
  assert.throws(() => reconcileEvaluateResponse(handoff, request, response), InputError);
  response.authority.selected_is_executed = false;
  request.candidates[0].description = 'Changed after projection';
  assert.throws(() => reconcileEvaluateResponse(handoff, request, response), InputError);
  handoff.admissible_candidate_ids.push('publish_report');
  assert.throws(() => buildEvaluateRequest(handoff, options), InputError);
});

test('bridge records a governed refusal without selecting an action', async () => {
  const { handoff, response } = await fixture();
  const request = buildEvaluateRequest(handoff, options);
  response.outcome = 'governed_noop_refusal';
  response.selected_candidate_id = null;
  response.reason_codes = ['insufficient_bounded_support'];
  const record = reconcileEvaluateResponse(handoff, request, response);
  assert.equal(record.evaluate_outcome, 'governed_noop_refusal');
  assert.equal(record.selected_candidate_id, null);
});

test('bridge stops on out-of-contract context or candidate count', async () => {
  const { handoff } = await fixture();
  assert.throws(() => buildEvaluateRequest(handoff, { ...options, context: { authorization: 'x' } }), InputError);
  assert.throws(() => buildEvaluateRequest(handoff, { ...options, objective: 'Bearer abcdefghijklmnop' }), InputError);
  handoff.original_decision.candidates[0].payload.semantic_class = 'external';
  assert.throws(() => buildEvaluateRequest(handoff, options), InputError);
});
