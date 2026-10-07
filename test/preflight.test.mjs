import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { preflight, InputError } from '../src/preflight.mjs';

const load = async name => JSON.parse(await readFile(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));

test('multiple allowed candidates require selection and handoff excludes rejected candidates', async () => {
  const input = await load('ci-deploy');
  const { result, handoff } = preflight(input);
  assert.equal(result.status, 'SELECTION_REQUIRED');
  assert.deepEqual(result.counts, { received: 3, admissible: 2, rejected: 1, unproven: 0 });
  assert.deepEqual(handoff.admissible_candidate_ids, ['deploy_canary', 'rollback']);
  assert.deepEqual(handoff.admissible_candidates.map(item => item.id), ['deploy_canary', 'rollback']);
  assert.deepEqual(handoff.original_decision, input);
  assert.equal(result.candidates[0].checks[0].reason, 'CONSTRAINT_VIOLATION');
});

test('one allowed candidate passes without a handoff', async () => {
  const input = await load('ci-deploy');
  input.candidates = input.candidates.slice(0, 2);
  const { result, handoff } = preflight(input);
  assert.equal(result.status, 'PASS_SINGLE');
  assert.deepEqual(result.admissible_candidate_ids, ['deploy_canary']);
  assert.equal(handoff, null);
});

test('missing evidence is unproven; no survivor refuses without calling it a violation', async () => {
  const input = await load('ci-deploy');
  input.candidates = [{ id: 'unknown', facts: { reversible: true } }];
  const { result } = preflight(input);
  assert.equal(result.status, 'REFUSE');
  assert.deepEqual(result.counts, { received: 1, admissible: 0, rejected: 0, unproven: 1 });
  assert.equal(result.candidates[0].checks[1].reason, 'MISSING_EVIDENCE');
});

test('an explicit failure overrides missing evidence and exists rejects absence', async () => {
  const input = await load('ci-deploy');
  input.candidates = [{ id: 'bad', facts: { reversible: false } }];
  input.constraints[1] = { id: 'radius_present', source: 'candidate', path: '/blast_radius', op: 'exists' };
  const { result } = preflight(input);
  assert.equal(result.candidates[0].verdict, 'rejected');
  assert.equal(result.candidates[0].checks[1].reason, 'MISSING_REQUIRED_FACT');
});

test('canonical receipts ignore object key order and change when facts change', async () => {
  const input = await load('ci-deploy');
  const reordered = {
    constraints: input.constraints,
    candidates: input.candidates.map(candidate => ({ facts: candidate.facts, id: candidate.id })),
    context: { objective: input.context.objective, environment: input.context.environment },
    decision_id: input.decision_id,
    schema_version: input.schema_version
  };
  const first = preflight(input).result.receipt;
  assert.deepEqual(preflight(reordered).result.receipt, first);
  reordered.candidates[1].facts = { ...reordered.candidates[1].facts, blast_radius: 4 };
  assert.notEqual(preflight(reordered).result.receipt.input_hash, first.input_hash);
});

test('invalid envelopes fail before decision status', async () => {
  const input = await load('ci-deploy');
  input.candidates[1].id = input.candidates[0].id;
  assert.throws(() => preflight(input), InputError);
  input.candidates[1].id = 'unsafe\u001b[31m';
  assert.throws(() => preflight(input), InputError);
});

test('CLI exit codes distinguish selection, single pass, refusal, and invalid input', async () => {
  const cli = new URL('../bin/preflight.mjs', import.meta.url).pathname;
  const selection = spawnSync(process.execPath, [cli, new URL('../examples/ci-deploy.json', import.meta.url).pathname, '--json'], { encoding: 'utf8' });
  assert.equal(selection.status, 2);
  assert.equal(JSON.parse(selection.stdout).result.status, 'SELECTION_REQUIRED');

  const input = await load('ci-deploy');
  input.candidates = input.candidates.slice(0, 2);
  const single = spawnSync(process.execPath, [cli, '-', '--json'], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(single.status, 0);
  input.candidates = input.candidates.slice(0, 1);
  const refuse = spawnSync(process.execPath, [cli, '-', '--json'], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(refuse.status, 3);
  const invalid = spawnSync(process.execPath, [cli, '-', '--json'], { input: '{}', encoding: 'utf8' });
  assert.equal(invalid.status, 64);
});
