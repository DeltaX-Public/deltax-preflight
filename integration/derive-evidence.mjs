#!/usr/bin/env node
import { readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { decisionHash, validateDecision, InputError } from '../src/preflight.mjs';

const [decisionName, manifestName, outputName] = process.argv.slice(2);
if (!decisionName || !manifestName || !outputName || process.argv.length !== 5)
  throw new InputError('Usage: derive-evidence <proposal> <trusted-manifest> <output>');
const workspace = await realpath(process.env.GITHUB_WORKSPACE ?? process.cwd());

function inside(path) {
  const rel = relative(workspace, path);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`))
    throw new InputError('integration path must stay within the workspace');
  return path;
}

async function readJson(name) {
  const supplied = resolve(workspace, name);
  if ((await lstat(supplied)).isSymbolicLink()) throw new InputError('integration inputs cannot be symlinks');
  const file = inside(await realpath(supplied));
  const bytes = await readFile(file);
  if (bytes.length > 1024 * 1024) throw new InputError('integration input exceeds 1 MiB');
  return JSON.parse(bytes.toString('utf8'));
}

const decision = await readJson(decisionName);
validateDecision(decision);
const manifest = await readJson(manifestName);
if (manifest.schema_version !== '1' || manifest.kind !== 'reviewed-candidate-manifest'
  || !Array.isArray(manifest.candidates)) throw new InputError('invalid trusted manifest');
const reviewed = new Map();
for (const entry of manifest.candidates) {
  if (typeof entry.id !== 'string' || reviewed.has(entry.id)
    || entry.payload === null || typeof entry.payload !== 'object' || Array.isArray(entry.payload)
    || entry.facts === null || typeof entry.facts !== 'object' || Array.isArray(entry.facts))
    throw new InputError('invalid trusted manifest candidate');
  reviewed.set(entry.id, entry);
}
const evidence = {
  schema_version: '2', kind: 'evidence', evidence_id: 'trusted-ci-manifest-comparison',
  source: 'base-branch-reviewed-manifest', decision_hash: decisionHash(decision),
  context: {},
  candidates: decision.candidates.map(candidate => {
    const known = reviewed.get(candidate.id);
    return { id: candidate.id, facts: known && isDeepStrictEqual(candidate.payload, known.payload)
      ? structuredClone(known.facts) : {} };
  })
};
const output = resolve(workspace, outputName);
inside(await realpath(dirname(output)));
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
process.stdout.write('Evidence derived from the trusted manifest and canonical proposal content.\n');
