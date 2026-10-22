import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { preflight } from '../../src/preflight.mjs';

test('the production container serves the exact local Preflight report without network access', { timeout: 30_000 }, async t => {
  const client = new Client({ name: 'preflight-container-check', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: 'docker',
    args: ['run', '--rm', '-i', '--network=none', 'deltax-preflight-mcp:ci'],
    stderr: 'pipe'
  });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'preflight_check', 'preflight_hash_decision', 'preflight_hash_policy'
  ]);
  const [decision, policy, evidence] = await Promise.all(['ci-deploy', 'ci-policy', 'ci-evidence'].map(async name =>
    JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'))));
  const response = await client.callTool({ name: 'preflight_check', arguments: { decision, policy, evidence } });
  assert.notEqual(response.isError, true);
  const expected = preflight(decision, policy, evidence);
  assert.deepEqual(response.structuredContent, expected);
  assert.deepEqual(JSON.parse(response.content[0].text), expected);
});
