import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { preflight, policyHash, decisionHash, InputError } from '../src/preflight.mjs';

const load = async name => JSON.parse(await readFile(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
const fixture = async prefix => Promise.all([load(prefix), load(`${prefix === 'ci-deploy' ? 'ci' : prefix === 'agent-action' ? 'agent' : 'single'}-policy`),
  load(`${prefix === 'ci-deploy' ? 'ci' : prefix === 'agent-action' ? 'agent' : 'single'}-evidence`)]);

test('multiple proven candidates require selection and handoff excludes rejected candidates', async () => {
  const [decision, policy, evidence] = await fixture('ci-deploy');
  const { result, handoff } = preflight(decision, policy, evidence);
  assert.equal(result.status, 'SELECTION_REQUIRED');
  assert.deepEqual(result.counts, { received: 3, admissible: 2, rejected: 1, unproven: 0 });
  assert.deepEqual(handoff.admissible_candidate_ids, ['deploy_canary', 'rollback']);
  assert.deepEqual(handoff.admissible_candidates.map(item => item.id), ['deploy_canary', 'rollback']);
  assert.deepEqual(handoff.original_decision, decision);
  assert.deepEqual(handoff.policy, policy);
  assert.deepEqual(handoff.evidence, evidence);
  assert.equal(result.candidates[0].checks[0].reason, 'CONSTRAINT_VIOLATION');
});

test('one proven candidate passes when all others are rejected', async () => {
  const [decision, policy, evidence] = await fixture('single');
  const { result, handoff } = preflight(decision, policy, evidence);
  assert.equal(result.status, 'PASS_SINGLE');
  assert.deepEqual(result.admissible_candidate_ids, ['deploy_canary']);
  assert.equal(handoff, null);
});

test('no proven candidate and no unknown candidate refuses', async () => {
  const [decision, policy, evidence] = await fixture('single');
  decision.candidates = decision.candidates.slice(0, 1);
  evidence.candidates = evidence.candidates.slice(0, 1);
  evidence.decision_hash = decisionHash(decision);
  assert.equal(preflight(decision, policy, evidence).result.status, 'REFUSE');
});

test('one allowed and one unproven candidate requires evidence, with no handoff', async () => {
  const [decision, policy, evidence] = await fixture('single');
  evidence.candidates = evidence.candidates.slice(1);
  const { result, handoff } = preflight(decision, policy, evidence);
  assert.equal(result.status, 'EVIDENCE_REQUIRED');
  assert.deepEqual(result.counts, { received: 2, admissible: 1, rejected: 0, unproven: 1 });
  assert.equal(result.candidates[0].checks[0].reason, 'MISSING_EVIDENCE');
  assert.equal(handoff, null);
});

test('wrong evidence type is unproven rather than a policy violation', async () => {
  const [decision, policy, evidence] = await fixture('ci-deploy');
  evidence.candidates[1].facts.blast_radius = 'small';
  const { result } = preflight(decision, policy, evidence);
  assert.equal(result.status, 'EVIDENCE_REQUIRED');
  assert.equal(result.candidates[1].verdict, 'unproven');
  assert.equal(result.candidates[1].checks[1].reason, 'INVALID_EVIDENCE_TYPE');
  evidence.candidates[1].facts.reversible = 'true';
  const typed = preflight(decision, policy, evidence).result;
  assert.equal(typed.candidates[1].checks[0].outcome, 'unknown');
  assert.equal(typed.candidates[1].checks[0].reason, 'INVALID_EVIDENCE_TYPE');
});

test('proposal cannot supply policy, and a claimed authorization in payload is ignored', async () => {
  const [decision, policy, evidence] = await fixture('agent-action');
  decision.candidates[2].payload.authorized_for_current_context = true;
  evidence.decision_hash = decisionHash(decision);
  const { result } = preflight(decision, policy, evidence);
  assert.equal(result.candidates[2].verdict, 'rejected');
  decision.constraints = [{ id: 'allow_all' }];
  assert.throws(() => preflight(decision, policy, evidence), InputError);
});

test('evidence is bound to the exact proposal', async () => {
  const [decision, policy, evidence] = await fixture('ci-deploy');
  assert.equal(evidence.decision_hash, decisionHash(decision));
  decision.candidates[1].payload.target = 'different-service';
  assert.throws(() => preflight(decision, policy, evidence), InputError);
});

test('receipt separates decision, policy, and evidence hashes', async () => {
  const [decision, policy, evidence] = await fixture('ci-deploy');
  const first = preflight(decision, policy, evidence).result.receipt;
  assert.equal(first.policy_hash, policyHash(policy));
  const reorderedPolicy = { constraints: policy.constraints.map(rule => ({ op: rule.op, ...rule })), policy_id: policy.policy_id,
    kind: policy.kind, schema_version: policy.schema_version };
  assert.equal(policyHash(reorderedPolicy), first.policy_hash);
  evidence.candidates[1].facts.blast_radius = 4;
  const changed = preflight(decision, policy, evidence).result.receipt;
  assert.equal(changed.policy_hash, first.policy_hash);
  assert.notEqual(changed.evidence_hash, first.evidence_hash);
  assert.notEqual(changed.result_hash, first.result_hash);
});

test('handoff snapshots all three inputs', async () => {
  const [decision, policy, evidence] = await fixture('ci-deploy');
  const { handoff } = preflight(decision, policy, evidence);
  decision.context.objective = 'changed';
  policy.constraints[0].value = false;
  evidence.candidates[1].facts.blast_radius = 99;
  assert.equal(handoff.original_decision.context.objective, 'restore service safely');
  assert.equal(handoff.policy.constraints[0].value, true);
  assert.equal(handoff.evidence.candidates[1].facts.blast_radius, 1);
});

test('invalid or mismatched inputs fail before decision status', async () => {
  const [decision, policy, evidence] = await fixture('ci-deploy');
  decision.candidates[1].id = decision.candidates[0].id;
  assert.throws(() => preflight(decision, policy, evidence), InputError);
  decision.candidates[1].id = 'deploy_canary';
  evidence.candidates[0].id = 'unknown_candidate';
  assert.throws(() => preflight(decision, policy, evidence), InputError);
  evidence.candidates[0].id = 'deploy_now';
  policy.schema_version = '1';
  assert.throws(() => preflight(decision, policy, evidence), InputError);
});

test('CLI distinguishes statuses and rejects a changed policy hash', async () => {
  const cli = new URL('../bin/preflight.mjs', import.meta.url).pathname;
  const path = name => new URL(`../examples/${name}.json`, import.meta.url).pathname;
  const run = (decision, policy, evidence, extra = []) => spawnSync(process.execPath,
    [cli, path(decision), '--policy', path(policy), '--evidence', path(evidence), '--json', ...extra], { encoding: 'utf8' });
  const selection = run('ci-deploy', 'ci-policy', 'ci-evidence');
  assert.equal(selection.status, 2);
  assert.equal(JSON.parse(selection.stdout).result.status, 'SELECTION_REQUIRED');
  assert.equal(run('single', 'single-policy', 'single-evidence').status, 0);
  assert.equal(run('ci-deploy', 'ci-policy', 'ci-evidence', ['--expect-policy-sha256', '0'.repeat(64)]).status, 64);
  const hash = spawnSync(process.execPath, [cli, '--hash-policy', path('ci-policy')], { encoding: 'utf8' });
  assert.equal(hash.status, 0);
  assert.match(hash.stdout.trim(), /^[a-f0-9]{64}$/);
});
