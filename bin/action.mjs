import { readFile, appendFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { preflight, InputError } from '../src/preflight.mjs';

const MAX_BYTES = 1024 * 1024;

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE;
  const expectedHash = process.env.INPUT_EXPECTED_POLICY_SHA256;
  if (!workspace || !process.env.INPUT_DECISION_FILE || !process.env.INPUT_POLICY_FILE
    || !process.env.INPUT_EVIDENCE_FILE || !expectedHash)
    throw new InputError('workspace, decision_file, policy_file, evidence_file, and expected_policy_sha256 are required');
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new InputError('expected_policy_sha256 must be a lowercase SHA-256 hash');
  const workspacePath = await realpath(workspace);
  async function readJson(supplied, label) {
    const file = await realpath(resolve(workspacePath, supplied));
    const within = relative(workspacePath, file);
    if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`))
      throw new InputError(`${label} must stay within the checked-out workspace`);
    const bytes = await readFile(file);
    if (bytes.length > MAX_BYTES) throw new InputError(`${label} exceeds 1 MiB`);
    try { return JSON.parse(bytes.toString('utf8')); }
    catch { throw new InputError(`${label} is not valid JSON`); }
  }
  const decision = await readJson(process.env.INPUT_DECISION_FILE, 'decision_file');
  const policy = await readJson(process.env.INPUT_POLICY_FILE, 'policy_file');
  const evidence = await readJson(process.env.INPUT_EVIDENCE_FILE, 'evidence_file');
  const { result } = preflight(decision, policy, evidence);
  if (result.receipt.policy_hash !== expectedHash) throw new InputError('policy hash mismatch');
  process.stdout.write(`Preflight: ${result.status}; ${result.counts.admissible}/${result.counts.received} admissible\n`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT,
      `status=${result.status}\nadmissible_count=${result.counts.admissible}\nreceipt_hash=${result.receipt.result_hash}\npolicy_hash=${result.receipt.policy_hash}\n`);
  }
  process.exitCode = result.status === 'PASS_SINGLE' ? 0
    : result.status === 'SELECTION_REQUIRED' ? 2
    : result.status === 'REFUSE' ? 3 : 4;
}

main().catch(error => {
  process.stderr.write(`Preflight action error: ${error.message}\n`);
  process.exitCode = error instanceof InputError || error.code === 'ENOENT' ? 64 : 1;
});
