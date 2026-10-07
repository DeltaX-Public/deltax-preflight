#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { preflight, policyHash, decisionHash, InputError } from '../src/preflight.mjs';

const MAX_BYTES = 1024 * 1024;

function usage() {
  process.stderr.write('Usage: deltax-preflight <decision.json|-> --policy <policy.json> --evidence <evidence.json> [--expect-policy-sha256 <hash>] [--json]\n');
  process.stderr.write('       deltax-preflight --hash-policy <policy.json>\n');
  process.stderr.write('       deltax-preflight --hash-decision <decision.json>\n');
  process.exitCode = 64;
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new InputError('decision exceeds 1 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(path, label) {
  const bytes = path === '-' ? await readStdin() : await readFile(path);
  if (bytes.length > MAX_BYTES) throw new InputError(`${label} exceeds 1 MiB`);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new InputError(`${label} is not valid JSON`); }
}

function parseArgs(args) {
  if (args[0] === '--hash-policy' && args.length === 2 && args[1] !== '-')
    return { hashPolicyPath: args[1] };
  if (args[0] === '--hash-decision' && args.length === 2 && args[1] !== '-')
    return { hashDecisionPath: args[1] };
  const options = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') options.json = true;
    else if (['--policy', '--evidence', '--expect-policy-sha256'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) return null;
      options[arg.slice(2)] = value;
    } else if (arg === '-' || !arg.startsWith('--')) {
      if (options.decision) return null;
      options.decision = arg;
    } else return null;
  }
  if (!options.decision || !options.policy || !options.evidence || options.policy === '-' || options.evidence === '-') return null;
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return usage();
  if (options.hashPolicyPath) {
    process.stdout.write(`${policyHash(await readJson(options.hashPolicyPath, 'policy'))}\n`);
    return;
  }
  if (options.hashDecisionPath) {
    process.stdout.write(`${decisionHash(await readJson(options.hashDecisionPath, 'decision'))}\n`);
    return;
  }
  const decision = await readJson(options.decision, 'decision');
  const policy = await readJson(options.policy, 'policy');
  const evidence = await readJson(options.evidence, 'evidence');
  const { result, handoff } = preflight(decision, policy, evidence);
  if (options['expect-policy-sha256']) {
    const expected = options['expect-policy-sha256'];
    if (!/^[a-f0-9]{64}$/.test(expected) || expected !== result.receipt.policy_hash)
      throw new InputError('policy hash mismatch');
  }
  if (options.json) process.stdout.write(`${JSON.stringify({ result, handoff }, null, 2)}\n`);
  else {
    process.stdout.write(`PREFLIGHT: ${result.status}\n`);
    process.stdout.write(`${result.counts.admissible}/${result.counts.received} admissible; ${result.counts.rejected} rejected; ${result.counts.unproven} unproven\n`);
    for (const candidate of result.candidates) {
      process.stdout.write(`- ${candidate.id}: ${candidate.verdict}\n`);
      for (const check of candidate.checks.filter(item => item.outcome !== 'pass'))
        process.stdout.write(`  ${check.constraint_id}: ${check.outcome} (${check.reason})\n`);
    }
    if (handoff) process.stdout.write('Selection remains unresolved. Use --json for the optional local Evaluate handoff.\n');
    if (result.status === 'EVIDENCE_REQUIRED') process.stdout.write('Resolve missing or invalid evidence before selection.\n');
    process.stdout.write(`Receipt: sha256:${result.receipt.result_hash}\n`);
  }
  process.exitCode = result.status === 'PASS_SINGLE' ? 0
    : result.status === 'SELECTION_REQUIRED' ? 2
    : result.status === 'REFUSE' ? 3 : 4;
}

main().catch(error => {
  process.stderr.write(`Preflight input error: ${error.message}\n`);
  process.exitCode = error instanceof InputError || error.code === 'ENOENT' ? 64 : 1;
});
