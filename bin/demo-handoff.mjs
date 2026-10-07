#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { preflight } from '../src/preflight.mjs';
import { buildEvaluateRequest, reconcileEvaluateResponse } from '../src/evaluate-bridge.mjs';

const load = async name => JSON.parse(await readFile(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
const [decision, policy, evidence, response] = await Promise.all([
  load('review-decision'), load('review-policy'), load('review-evidence'),
  load('review-response.synthetic')
]);
const { result, handoff } = preflight(decision, policy, evidence);
const request = buildEvaluateRequest(handoff, {
  objective: 'Choose a bounded review step for a synthetic evidence packet. Do not perform external actions.',
  context: { evidence_kind: 'synthetic_review_example', external_actions_allowed: false }
});
const record = reconcileEvaluateResponse(handoff, request, response);
process.stdout.write(`${JSON.stringify({
  demonstration: 'offline synthetic response; no hosted call or execution',
  validation: {
    status: result.status,
    candidates: result.candidates.map(candidate => ({ id: candidate.id, verdict: candidate.verdict })),
    receipt: result.receipt
  },
  evaluate_request: request,
  selection_record: record
}, null, 2)}\n`);
