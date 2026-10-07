import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../src/preflight.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const producer = join(root, 'integration/derive-evidence.mjs');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

test('trusted manifest derives evidence for exact proposal and stops changed payload', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'preflight-integration-'));
  try {
    await mkdir(join(workspace, 'trusted/integration'), { recursive: true });
    await mkdir(join(workspace, 'proposal/integration'), { recursive: true });
    await cp(join(root, 'integration/ci-manifest.json'), join(workspace, 'trusted/integration/ci-manifest.json'));
    await cp(join(root, 'integration/ci-policy.json'), join(workspace, 'trusted/integration/ci-policy.json'));
    await cp(join(root, 'integration/ci-proposal.json'), join(workspace, 'proposal/integration/ci-proposal.json'));
    const run = output => spawnSync(process.execPath, [producer,
      'proposal/integration/ci-proposal.json', 'trusted/integration/ci-manifest.json', output],
    { encoding: 'utf8', env: { ...process.env, GITHUB_WORKSPACE: workspace } });
    assert.equal(run('evidence.json').status, 0);
    const proposalPath = join(workspace, 'proposal/integration/ci-proposal.json');
    const policy = await readJson(join(workspace, 'trusted/integration/ci-policy.json'));
    const proposal = await readJson(proposalPath);
    const evidence = await readJson(join(workspace, 'evidence.json'));
    assert.equal(preflight(proposal, policy, evidence).result.status, 'PASS_SINGLE');
    proposal.candidates[0].payload.scope = 'public';
    await writeFile(proposalPath, JSON.stringify(proposal));
    assert.equal(run('changed-evidence.json').status, 0);
    const changed = await readJson(join(workspace, 'changed-evidence.json'));
    const result = preflight(proposal, policy, changed).result;
    assert.equal(result.status, 'EVIDENCE_REQUIRED');
    assert.equal(result.candidates[0].verdict, 'unproven');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
