#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decisionHash } from '../src/preflight.mjs';

if (process.argv.length !== 3 || process.argv[2].startsWith('-')) {
  process.stderr.write('Usage: node bin/init.mjs <new-folder>\n');
  process.exit(64);
}

const folder = resolve(process.argv[2]);
const decision = {
  schema_version: '2', kind: 'decision', decision_id: 'my-first-preflight',
  context: { objective: 'Choose the next step' },
  candidates: [
    { id: 'inspect_locally', payload: { operation: 'inspect_locally' } },
    { id: 'publish_now', payload: { operation: 'publish_now' } }
  ]
};
const policy = {
  schema_version: '2', kind: 'policy', policy_id: 'my-first-policy',
  constraints: [
    { id: 'within_scope', source: 'candidate', path: '/within_scope', op: 'eq', value: true },
    { id: 'authorized', source: 'candidate', path: '/authorized', op: 'eq', value: true }
  ]
};
const evidence = {
  schema_version: '2', kind: 'evidence', evidence_id: 'starter-evidence-unverified',
  source: 'replace-with-trusted-producer', decision_hash: decisionHash(decision),
  context: {},
  candidates: decision.candidates.map(candidate => ({ id: candidate.id, facts: {} }))
};
const guide = `# Your first Preflight check

These are valid starter files. Their evidence is deliberately empty, so the first run returns \`EVIDENCE_REQUIRED\` rather than claiming either option is allowed.

1. Edit \`decision.json\` with the actual candidate IDs and payloads.
2. Keep \`policy.json\` under the workflow owner's control. Its rules are hard requirements, not preferences.
3. Obtain facts from a source authorized to assert them. Put those facts in \`evidence.json\`; the candidate payload is not proof. Replace the \`source\` label. For this starter policy, each candidate needs Boolean \`within_scope\` and \`authorized\` facts. A missing fact remains unproven.
4. After any decision edit, update \`evidence.decision_hash\` with \`node bin/preflight.mjs --hash-decision <path-to-decision.json>\` from the Preflight repository root. The evidence producer should bind facts to the exact proposal it checked.
5. Run \`node bin/preflight.mjs <path-to-decision.json> --policy <path-to-policy.json> --evidence <path-to-evidence.json>\` from the repository root. Use \`--json\` for a machine-readable result.

Only assert a fact when you have evidence for it. Preflight cannot authenticate the \`source\` label or make a self-reported fact trustworthy. A passing result does not execute anything. See the main repository README for the GitHub Action and Evaluate handoff.
`;

try {
  await mkdir(folder);
  await Promise.all([
    writeFile(resolve(folder, 'decision.json'), `${JSON.stringify(decision, null, 2)}\n`, { flag: 'wx' }),
    writeFile(resolve(folder, 'policy.json'), `${JSON.stringify(policy, null, 2)}\n`, { flag: 'wx' }),
    writeFile(resolve(folder, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' }),
    writeFile(resolve(folder, 'README.md'), guide, { flag: 'wx' })
  ]);
  process.stdout.write(`Created starter files in ${folder}. First run should return EVIDENCE_REQUIRED until trusted facts are supplied.\n`);
} catch (error) {
  process.stderr.write(`Could not create starter files: ${error.message}\n`);
  process.exitCode = 1;
}
