import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const action = join(root, 'bin/action.mjs');

test('GitHub Action reports status, fails unresolved selection, and blocks paths outside workspace', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'preflight-action-'));
  const output = join(temp, 'outputs');
  const run = decisionFile => spawnSync(process.execPath, [action], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_WORKSPACE: root, GITHUB_OUTPUT: output, INPUT_DECISION_FILE: decisionFile }
  });
  try {
    const single = run('examples/single.json');
    assert.equal(single.status, 0);
    assert.match(await readFile(output, 'utf8'), /status=PASS_SINGLE\nadmissible_count=1\nreceipt_hash=[a-f0-9]{64}/);
    const multiple = run('examples/ci-deploy.json');
    assert.equal(multiple.status, 2);
    assert.match(await readFile(output, 'utf8'), /status=SELECTION_REQUIRED\nadmissible_count=2/);
    const outside = run('/etc/hosts');
    assert.equal(outside.status, 64);
    assert.match(outside.stderr, /must stay within/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
