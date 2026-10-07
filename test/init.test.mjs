import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decisionHash, preflight } from '../src/preflight.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const init = join(root, 'bin/init.mjs');

test('starter creates valid files that require evidence and never overwrites them', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'preflight-starter-'));
  const folder = join(temp, 'new-check');
  const load = async name => JSON.parse(await readFile(join(folder, `${name}.json`), 'utf8'));
  try {
    const created = spawnSync(process.execPath, [init, folder], { encoding: 'utf8' });
    assert.equal(created.status, 0);
    const [decision, policy, evidence] = await Promise.all([
      load('decision'), load('policy'), load('evidence')
    ]);
    assert.equal(evidence.decision_hash, decisionHash(decision));
    assert.equal(preflight(decision, policy, evidence).result.status, 'EVIDENCE_REQUIRED');
    assert.match(await readFile(join(folder, 'README.md'), 'utf8'), /source authorized to assert/);
    const repeated = spawnSync(process.execPath, [init, folder], { encoding: 'utf8' });
    assert.equal(repeated.status, 1);
    assert.deepEqual(await load('decision'), decision);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
