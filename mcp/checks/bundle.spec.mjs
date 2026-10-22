import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { preflight, decisionHash } from '../../src/preflight.mjs';
import { prepareBundle, buildBundle, repositoryRoot } from '../bundle/build.mjs';

const loadJson = async filename => JSON.parse(await readFile(filename, 'utf8'));
const tools = ['preflight_check', 'preflight_hash_decision', 'preflight_hash_policy'];

async function scratch(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'preflight-mcpb-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function assertStandalone(directory) {
  const manifest = await loadJson(path.join(directory, 'manifest.json'));
  const installed = await loadJson(path.join(directory, 'mcp/package.json'));
  assert.equal(installed.devDependencies, undefined);
  assert.equal(installed.scripts, undefined);
  assert.equal(manifest.server.entry_point, 'mcp/bin/server.mjs');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/mcp/bin/server.mjs']);
  assert.equal(manifest.user_config, undefined);
  assert.equal(manifest.server.mcp_config.env, undefined);
  assert.deepEqual(manifest.tools.map(tool => tool.name).sort(), tools);
  const fileNames = await readdir(path.join(directory, 'src'));
  assert.deepEqual(fileNames, ['preflight.mjs']);
  for (const filename of ['src/preflight.mjs', 'mcp/bin/server.mjs', 'mcp/src/server.mjs']) {
    assert.deepEqual(await readFile(path.join(directory, filename)), await readFile(path.join(repositoryRoot, filename)));
  }
  await assert.rejects(readFile(path.join(directory, 'mcp/node_modules/@modelcontextprotocol/client/package.json')), { code: 'ENOENT' });

  const client = new Client({ name: 'preflight-bundle-checks', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(directory, manifest.server.entry_point)],
    cwd: directory,
    env: { PATH: process.env.PATH ?? '', NO_COLOR: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), tools);
    const [decision, policy, evidence] = await Promise.all(['ci-deploy', 'ci-policy', 'ci-evidence'].map(name =>
      loadJson(path.join(repositoryRoot, 'examples', `${name}.json`))));
    const expected = preflight(decision, policy, evidence);
    assert.equal(expected.result.status, 'SELECTION_REQUIRED');
    const checked = await client.callTool({ name: 'preflight_check', arguments: { decision, policy, evidence } });
    assert.notEqual(checked.isError, true);
    assert.deepEqual(checked.structuredContent, expected);
    assert.deepEqual(JSON.parse(checked.content[0].text), expected);
    const hashed = await client.callTool({ name: 'preflight_hash_decision', arguments: { decision } });
    assert.deepEqual(hashed.structuredContent, { decision_hash: decisionHash(decision) });
    const invalid = await client.callTool({ name: 'preflight_check', arguments: { decision: null, policy, evidence } });
    assert.equal(invalid.isError, true);
    const recovered = await client.callTool({ name: 'preflight_check', arguments: { decision, policy, evidence } });
    assert.deepEqual(recovered.structuredContent, expected);
  } finally {
    await client.close();
  }
}

test('MCPB staging is self-contained, preserves the core bytes and excludes development dependencies', { timeout: 30_000 }, async t => {
  const directory = await scratch(t);
  const prepared = await prepareBundle({ stageDir: path.join(directory, 'stage') });
  assert.equal(prepared.version, '0.1.0');
  assert.ok(prepared.productionPackages > 0);
  await assertStandalone(prepared.stageDir);
});

test('MCPB preparation refuses existing paths and paths inside the repository', async t => {
  const directory = await scratch(t);
  const existing = path.join(directory, 'existing');
  await mkdir(existing);
  await writeFile(path.join(existing, 'owner.txt'), 'preserve');
  await assert.rejects(prepareBundle({ stageDir: existing }), /Refusing to overwrite/);
  assert.equal(await readFile(path.join(existing, 'owner.txt'), 'utf8'), 'preserve');
  await assert.rejects(prepareBundle({ stageDir: path.join(repositoryRoot, 'mcp/bundle/stage') }), /outside the repository/);
});

test('official MCPB validation and packing yield an installable extracted stdio server', {
  timeout: 60_000,
  skip: !process.env.MCPB_CLI && 'Set MCPB_CLI to the official @anthropic-ai/mcpb dist/cli/cli.js to test the packed archive.'
}, async t => {
  const directory = await scratch(t);
  const outputPath = path.join(directory, 'deltax-preflight-mcp-0.1.0.mcpb');
  const result = await buildBundle({
    stageDir: path.join(directory, 'stage'),
    outputPath,
    mcpbCli: process.env.MCPB_CLI
  });
  assert.equal(result.releaseTag, 'mcp-v0.1.0');
  assert.match(result.fileSha256, /^[a-f0-9]{64}$/);
  const files = execFileSync('unzip', ['-Z1', outputPath], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(files.includes('manifest.json'));
  assert.ok(files.includes('src/preflight.mjs'));
  assert.ok(files.includes('mcp/bin/server.mjs'));
  assert.ok(!files.some(filename => filename.includes('@modelcontextprotocol/client/') || filename.includes('evaluate-bridge')));
  const extracted = path.join(directory, 'extracted');
  await mkdir(extracted);
  execFileSync('unzip', ['-q', outputPath, '-d', extracted]);
  await assertStandalone(extracted);
});
