import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runWorksheet } from '../src/worksheet.mjs';

const base = {
  objective: 'Choose a next step',
  options: ['Inspect locally', 'Publish now'],
  requirements: ['Within scope'],
  answers: [['yes'], ['no']]
};

test('worksheet produces real Preflight states from simple answers', () => {
  const one = runWorksheet(base);
  assert.equal(one.result.status, 'PASS_SINGLE');
  assert.deepEqual(one.result.admissible_candidate_ids, ['option_1']);
  assert.equal(one.evidence.source, 'interactive-self-report');
  const multiple = runWorksheet({ ...base, answers: [['yes'], ['yes']] });
  assert.equal(multiple.result.status, 'SELECTION_REQUIRED');
  assert.ok(multiple.handoff);
  const unknown = runWorksheet({ ...base, answers: [['yes'], ['unknown']] });
  assert.equal(unknown.result.status, 'EVIDENCE_REQUIRED');
  assert.equal(unknown.handoff, null);
});

test('one-command example displays the validity-to-selection gap', () => {
  const cli = new URL('../bin/try.mjs', import.meta.url).pathname;
  const run = spawnSync(process.execPath, [cli, '--example'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /SELECTION_REQUIRED/);
  assert.match(run.stdout, /Publish now: rejected/);
  assert.match(run.stdout, /self-reported|synthetic example/);
});
