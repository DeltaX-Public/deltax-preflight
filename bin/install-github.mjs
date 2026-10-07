#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { policyHash } from '../src/preflight.mjs';

const targetArg = process.argv[2];
if (process.argv.length !== 3 || !targetArg || targetArg.startsWith('-')) {
  process.stderr.write('Usage: node bin/install-github.mjs <path-to-repository-root>\n');
  process.exit(64);
}

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = join(sourceRoot, 'examples', 'github-agent-gate');

try {
  const target = await realpath(targetArg);
  const gitRoot = await realpath(execFileSync('git', ['-C', target, 'rev-parse', '--show-toplevel'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  if (target !== gitRoot) throw new Error('point to the root of a Git repository');
  const commit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('could not resolve a reviewed Preflight commit');
  const policyText = await readFile(join(templateRoot, 'policy.json'), 'utf8');
  const hash = policyHash(JSON.parse(policyText));
  const workflow = (await readFile(join(templateRoot, 'preflight.yml.tpl'), 'utf8'))
    .replaceAll('__PREFLIGHT_COMMIT__', commit).replaceAll('__POLICY_HASH__', hash);
  const files = new Map([
    [join(target, '.preflight', 'decision.json'), await readFile(join(templateRoot, 'decision.json'))],
    [join(target, '.preflight', 'policy.json'), policyText],
    [join(target, '.preflight', 'manifest.json'), await readFile(join(templateRoot, 'manifest.json'))],
    [join(target, '.github', 'workflows', 'preflight.yml'), workflow]
  ]);
  for (const file of files.keys()) {
    try { await access(file); throw new Error(`refusing to overwrite ${file}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await mkdir(join(target, '.preflight'), { recursive: true });
  await mkdir(join(target, '.github', 'workflows'), { recursive: true });
  for (const [file, content] of files) await writeFile(file, content, { flag: 'wx' });
  process.stdout.write(`Installed the reviewed agent-action gate in ${target}.\n`);
  process.stdout.write('Review .preflight/manifest.json and policy.json, commit the files, then open a pull request.\n');
  process.stdout.write('The workflow checks proposed actions; it selects or executes nothing.\n');
} catch (error) {
  process.stderr.write(`Could not install Preflight: ${error.message}\n`);
  process.exitCode = 1;
}
