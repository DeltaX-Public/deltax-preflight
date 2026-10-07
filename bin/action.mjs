import { readFile, appendFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { preflight, InputError } from '../src/preflight.mjs';

const MAX_BYTES = 1024 * 1024;

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE;
  const supplied = process.env.INPUT_DECISION_FILE;
  if (!workspace || !supplied) throw new InputError('GITHUB_WORKSPACE and decision_file are required');
  const file = await realpath(resolve(workspace, supplied));
  const within = relative(await realpath(workspace), file);
  if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`))
    throw new InputError('decision_file must stay within the checked-out workspace');
  const bytes = await readFile(file);
  if (bytes.length > MAX_BYTES) throw new InputError('input exceeds 1 MiB');
  let input;
  try { input = JSON.parse(bytes.toString('utf8')); }
  catch { throw new InputError('input is not valid JSON'); }
  const { result } = preflight(input);
  process.stdout.write(`Preflight: ${result.status}; ${result.counts.admissible}/${result.counts.received} admissible\n`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT,
      `status=${result.status}\nadmissible_count=${result.counts.admissible}\nreceipt_hash=${result.receipt.result_hash}\n`);
  }
  process.exitCode = result.status === 'PASS_SINGLE' ? 0 : result.status === 'SELECTION_REQUIRED' ? 2 : 3;
}

main().catch(error => {
  process.stderr.write(`Preflight action error: ${error.message}\n`);
  process.exitCode = error instanceof InputError || error.code === 'ENOENT' ? 64 : 1;
});
