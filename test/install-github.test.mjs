import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { policyHash } from '../src/preflight.mjs';

test('installer creates a pinned base-branch workflow and refuses to overwrite it', () => {
  const target = mkdtempSync(join(tmpdir(), 'preflight-install-'));
  try {
    const initialized = spawnSync('git', ['init', '--initial-branch=main', target], { encoding: 'utf8' });
    assert.equal(initialized.status, 0);
    const cli = new URL('../bin/install-github.mjs', import.meta.url).pathname;
    const first = spawnSync(process.execPath, [cli, target], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const workflow = readFileSync(join(target, '.github/workflows/preflight.yml'), 'utf8');
    const policy = JSON.parse(readFileSync(join(target, '.preflight/policy.json'), 'utf8'));
    assert.match(workflow, /pull_request_target:/);
    assert.match(workflow, /permissions:\n  contents: read/);
    assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
    assert.match(workflow, /proposal\/\.preflight\/decision\.json/);
    assert.match(workflow, new RegExp(policyHash(policy)));
    assert.doesNotMatch(workflow, /__PREFLIGHT_COMMIT__|__POLICY_HASH__/);
    const second = spawnSync(process.execPath, [cli, target], { encoding: 'utf8' });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /refusing to overwrite/);
    assert.equal(readFileSync(join(target, '.github/workflows/preflight.yml'), 'utf8'), workflow);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
