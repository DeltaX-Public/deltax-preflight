#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { preflight, InputError } from '../src/preflight.mjs';

const MAX_BYTES = 1024 * 1024;

function usage() {
  process.stderr.write('Usage: deltax-preflight <decision.json|-> [--json]\n');
  process.exitCode = 64;
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new InputError('input exceeds 1 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const paths = args.filter(arg => !arg.startsWith('--'));
  const path = paths[0];
  if (paths.length !== 1 || args.length > 2 || args.some(arg => arg.startsWith('--') && arg !== '--json')) return usage();
  const bytes = path === '-' ? await readStdin() : await readFile(path);
  if (Buffer.byteLength(bytes) > MAX_BYTES) throw new InputError('input exceeds 1 MiB');
  let input;
  try { input = JSON.parse(bytes.toString()); }
  catch { throw new InputError('input is not valid JSON'); }
  const { result, handoff } = preflight(input);
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ result, handoff }, null, 2)}\n`);
  } else {
    process.stdout.write(`PREFLIGHT: ${result.status}\n`);
    process.stdout.write(`${result.counts.admissible}/${result.counts.received} admissible; ${result.counts.rejected} rejected; ${result.counts.unproven} unproven\n`);
    for (const candidate of result.candidates) {
      process.stdout.write(`- ${candidate.id}: ${candidate.verdict}\n`);
      for (const check of candidate.checks.filter(item => item.outcome !== 'pass'))
        process.stdout.write(`  ${check.constraint_id}: ${check.outcome} (${check.reason})\n`);
    }
    if (handoff) process.stdout.write('Selection remains unresolved. Use --json to obtain the optional Evaluate handoff.\n');
    process.stdout.write(`Receipt: sha256:${result.receipt.result_hash}\n`);
  }
  process.exitCode = result.status === 'PASS_SINGLE' ? 0 : result.status === 'SELECTION_REQUIRED' ? 2 : 3;
}

main().catch(error => {
  process.stderr.write(`Preflight input error: ${error.message}\n`);
  process.exitCode = error instanceof InputError || error.code === 'ENOENT' ? 64 : 1;
});
