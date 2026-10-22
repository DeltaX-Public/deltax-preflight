import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { preflight, decisionHash, policyHash, InputError } from '../../src/preflight.mjs';

const load = async name => JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
const fixture = async (prefix = 'ci') => {
  const names = prefix === 'ci' ? ['ci-deploy', 'ci-policy', 'ci-evidence'] : ['single', 'single-policy', 'single-evidence'];
  const [decision, policy, evidence] = await Promise.all(names.map(load));
  return { decision, policy, evidence };
};
const textContent = response => response.content.filter(item => item.type === 'text').map(item => item.text);

function assertJsonResponse(response, expected) {
  assert.notEqual(response.isError, true);
  assert.deepEqual(response.structuredContent, expected);
  const texts = textContent(response);
  assert.equal(texts.length, 1);
  assert.deepEqual(JSON.parse(texts[0]), expected);
}

function coreError(operation) {
  try {
    operation();
    assert.fail('The core must reject this input');
  } catch (error) {
    assert.ok(error instanceof InputError);
    return error.message;
  }
}

test('the stdio MCP wrapper preserves the core boundary and remains usable after errors', { timeout: 30_000 }, async t => {
  const client = new Client({ name: 'preflight-protocol-checks', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../bin/server.mjs', import.meta.url))],
    // The standalone server must work without account credentials or an Evaluate service.
    env: { PATH: process.env.PATH ?? '', NO_COLOR: '1' },
    stderr: 'pipe',
  });
  t.after(async () => client.close());
  await client.connect(transport);

  const check = input => client.callTool({ name: 'preflight_check', arguments: input });
  const recover = async () => {
    const input = await fixture('single');
    assertJsonResponse(await check(input), preflight(input.decision, input.policy, input.evidence));
  };

  await t.test('discovery exposes exactly the three local tools with strict outer schemas', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), [
      'preflight_check', 'preflight_hash_decision', 'preflight_hash_policy',
    ]);
    const requiredByName = {
      preflight_check: ['decision', 'evidence', 'policy'],
      preflight_hash_decision: ['decision'],
      preflight_hash_policy: ['policy'],
    };
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object');
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.deepEqual([...tool.inputSchema.required].sort(), requiredByName[tool.name]);
    }
  });

  for (const status of ['SELECTION_REQUIRED', 'PASS_SINGLE', 'REFUSE', 'EVIDENCE_REQUIRED']) {
    await t.test(`${status} returns the exact core result, receipt, and handoff`, async () => {
      const input = await fixture(status === 'SELECTION_REQUIRED' ? 'ci' : 'single');
      if (status === 'REFUSE') {
        input.decision.candidates = input.decision.candidates.slice(0, 1);
        input.evidence.candidates = input.evidence.candidates.slice(0, 1);
        input.evidence.decision_hash = decisionHash(input.decision);
      } else if (status === 'EVIDENCE_REQUIRED') {
        input.evidence.candidates = input.evidence.candidates.slice(1);
      }
      const expected = preflight(input.decision, input.policy, input.evidence);
      const before = structuredClone(input);
      assert.equal(expected.result.status, status);
      const response = await check(input);
      assertJsonResponse(response, expected);
      assert.deepEqual(input, before);
      if (status === 'SELECTION_REQUIRED') {
        assert.deepEqual(response.structuredContent.handoff.admissible_candidate_ids, ['deploy_canary', 'rollback']);
        assert.deepEqual(response.structuredContent.handoff.admissible_candidates.map(candidate => candidate.id), ['deploy_canary', 'rollback']);
        assert.ok(!response.structuredContent.handoff.admissible_candidates.some(candidate => candidate.id === 'deploy_now'));
      } else {
        assert.equal(response.structuredContent.handoff, null);
      }
    });
  }

  await t.test('allowed JSON inside payload, context, and evidence is not reshaped', async () => {
    const input = await fixture();
    input.decision.context.caller_data = { nested: ['preserve', null, false] };
    input.decision.candidates[1].payload.caller_data = { instruction: 'opaque proposal data', amount: 3 };
    input.evidence.context.caller_data = { note: 'opaque observation data' };
    input.evidence.candidates[1].facts.caller_data = { nested: [1, 2] };
    input.evidence.decision_hash = decisionHash(input.decision);
    assertJsonResponse(await check(input), preflight(input.decision, input.policy, input.evidence));
  });

  await t.test('hash tools match core validation and canonical hashing', async () => {
    const { decision, policy } = await fixture();
    assertJsonResponse(await client.callTool({ name: 'preflight_hash_decision', arguments: { decision } }), {
      decision_hash: decisionHash(decision),
    });
    assertJsonResponse(await client.callTool({ name: 'preflight_hash_policy', arguments: { policy } }), {
      policy_hash: policyHash(policy),
    });
    const reordered = Object.fromEntries(Object.entries(policy).reverse());
    assertJsonResponse(await client.callTool({ name: 'preflight_hash_policy', arguments: { policy: reordered } }), {
      policy_hash: policyHash(policy),
    });
  });

  const badInputs = [
    ['null decision', input => { input.decision = null; }],
    ['array policy', input => { input.policy = []; }],
    ['scalar evidence', input => { input.evidence = 'invalid'; }],
    ['proposal/evidence hash mismatch', input => { input.decision.candidates[1].payload.target = 'different-service'; }],
    ['unknown evidence candidate', input => { input.evidence.candidates[0].id = 'unknown_candidate'; }],
    ['duplicate proposal candidate IDs', input => { input.decision.candidates[1].id = input.decision.candidates[0].id; }],
    ['duplicate policy constraint IDs', input => { input.policy.constraints[1].id = input.policy.constraints[0].id; }],
    ['duplicate evidence candidate IDs', input => { input.evidence.candidates[1].id = input.evidence.candidates[0].id; }],
    ...['decision', 'policy', 'evidence'].map(key => [`wrong ${key} schema version`, input => { input[key].schema_version = '1'; }]),
    ...['decision', 'policy', 'evidence'].map(key => [`unsupported ${key} field`, input => { input[key].unexpected_field = true; }]),
    ['unsupported proposal candidate field', input => { input.decision.candidates[0].unexpected_field = true; }],
    ['unsupported policy rule field', input => { input.policy.constraints[0].unexpected_field = true; }],
    ['unsupported evidence candidate field', input => { input.evidence.candidates[0].unexpected_field = true; }],
  ];
  for (const [label, mutate] of badInputs) {
    await t.test(`${label} preserves the core InputError and permits a later valid call`, async () => {
      const input = await fixture();
      mutate(input);
      const message = coreError(() => preflight(input.decision, input.policy, input.evidence));
      const response = await check(input);
      assert.equal(response.isError, true);
      assert.deepEqual(textContent(response), [message]);
      await recover();
    });
  }

  for (const [name, key, hash] of [
    ['preflight_hash_decision', 'decision', decisionHash],
    ['preflight_hash_policy', 'policy', policyHash],
  ]) {
    await t.test(`${name} also preserves the core InputError`, async () => {
      const input = (await fixture())[key];
      input.unexpected_field = true;
      const message = coreError(() => hash(input));
      const response = await client.callTool({ name, arguments: { [key]: input } });
      assert.equal(response.isError, true);
      assert.deepEqual(textContent(response), [message]);
      await recover();
    });
  }

  const valid = await fixture();
  const malformed = [
    ['missing all arguments', { name: 'preflight_check' }],
    ['missing required evidence', { name: 'preflight_check', arguments: { decision: valid.decision, policy: valid.policy } }],
    ['extra outer argument', { name: 'preflight_check', arguments: { ...valid, evaluate: true } }],
    ['null arguments', { name: 'preflight_check', arguments: null }],
    ['array arguments', { name: 'preflight_check', arguments: [] }],
    ['missing hash decision', { name: 'preflight_hash_decision', arguments: {} }],
    ['extra hash policy argument', { name: 'preflight_hash_policy', arguments: { policy: valid.policy, evaluate: true } }],
    ['unknown tool', { name: 'evaluate', arguments: {} }],
  ];
  for (const [label, request] of malformed) {
    await t.test(`${label} fails without ending the stdio session`, async () => {
      let response;
      let failure;
      try {
        response = await client.callTool(request);
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof Error || response?.isError === true, 'Malformed tool calls must fail');
      await recover();
    });
  }
});

test('a 2025-03-26 MCP client can initialize, discover tools, and check locally', { timeout: 10_000 }, async t => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/server.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH ?? '', NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let sequence = 0;
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  lines.on('line', line => {
    const message = JSON.parse(line);
    const receive = pending.get(message.id);
    if (receive) receive(message);
  });
  t.after(() => {
    lines.close();
    child.stdin.end();
    child.kill();
  });
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`No stdio response for ${method}. ${stderr}`));
    }, 3_000);
    pending.set(id, message => {
      clearTimeout(timeout);
      pending.delete(id);
      resolve(message);
    });
    send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
  });

  const initialized = await request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'preflight-legacy-protocol-check', version: '1.0.0' },
  });
  assert.equal(initialized.error, undefined);
  assert.equal(initialized.result.protocolVersion, '2025-03-26');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const discovery = await request('tools/list');
  assert.equal(discovery.error, undefined);
  assert.equal(discovery.result.tools.length, 3);
  const input = await fixture();
  const response = await request('tools/call', { name: 'preflight_check', arguments: input });
  assert.equal(response.error, undefined);
  assertJsonResponse(response.result, preflight(input.decision, input.policy, input.evidence));
});
