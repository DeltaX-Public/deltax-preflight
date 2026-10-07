import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { policyHash } from '../src/preflight.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const action = join(root, 'bin/action.mjs');
const loadPolicy = async name => JSON.parse(await readFile(join(root, 'examples', name), 'utf8'));

test('GitHub Action requires a pinned policy, reports status, and confines file paths', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'preflight-action-'));
  const output = join(temp, 'outputs');
  const expected = policyHash(await loadPolicy('single-policy.json'));
  const run = overrides => spawnSync(process.execPath, [action], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_WORKSPACE: root,
      GITHUB_OUTPUT: output,
      INPUT_DECISION_FILE: 'examples/single.json',
      INPUT_POLICY_FILE: 'examples/single-policy.json',
      INPUT_EVIDENCE_FILE: 'examples/single-evidence.json',
      INPUT_EXPECTED_POLICY_SHA256: expected,
      ...overrides
    }
  });
  try {
    const single = run();
    assert.equal(single.status, 0);
    assert.match(await readFile(output, 'utf8'), /status=PASS_SINGLE\nadmissible_count=1\nreceipt_hash=[a-f0-9]{64}\npolicy_hash=[a-f0-9]{64}/);
    const mismatch = run({ INPUT_EXPECTED_POLICY_SHA256: '0'.repeat(64) });
    assert.equal(mismatch.status, 64);
    assert.match(mismatch.stderr, /policy hash mismatch/);
    const outside = run({ INPUT_EVIDENCE_FILE: '/etc/hosts' });
    assert.equal(outside.status, 64);
    assert.match(outside.stderr, /must stay within/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
