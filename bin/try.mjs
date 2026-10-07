#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runWorksheet } from '../src/worksheet.mjs';

const args = process.argv.slice(2);
const example = args.length === 1 && args[0] === '--example';
const save = args.length === 2 && args[0] === '--save' && !args[1].startsWith('-') ? resolve(args[1]) : null;
if ((args.length > 0 && !example && !save) || (args.length === 0 && !stdin.isTTY)) {
  process.stderr.write('Usage: node bin/try.mjs [--example | --save <new-folder>]\n');
  process.stderr.write('Run without arguments in a terminal for an interactive worksheet.\n');
  process.exit(64);
}

async function askCount(rl, prompt, min, max) {
  for (;;) {
    const value = Number(await rl.question(prompt));
    if (Number.isInteger(value) && value >= min && value <= max) return value;
    stdout.write(`Enter a whole number from ${min} to ${max}.\n`);
  }
}

async function askNonempty(rl, prompt) {
  for (;;) {
    const value = (await rl.question(prompt)).trim();
    if (value.length >= 1 && value.length <= 200) return value;
    stdout.write('Enter 1 to 200 characters.\n');
  }
}

async function askAnswer(rl, prompt) {
  for (;;) {
    const value = (await rl.question(prompt)).trim().toLowerCase();
    if (['y', 'yes'].includes(value)) return 'yes';
    if (['n', 'no'].includes(value)) return 'no';
    if (['?', 'unknown', 'u'].includes(value)) return 'unknown';
    stdout.write('Answer y, n, or ? for unknown.\n');
  }
}

async function interact() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write('Preflight decision worksheet\n');
    stdout.write('Your answers are self-reported. Nothing is selected or executed.\n\n');
    const objective = await askNonempty(rl, 'What decision are you making? ');
    const count = await askCount(rl, 'How many options (1-8)? ', 1, 8);
    const options = [];
    for (let index = 0; index < count; index += 1)
      options.push(await askNonempty(rl, `Option ${index + 1}: `));
    const requirementCount = await askCount(rl, 'How many hard requirements (1-8)? ', 1, 8);
    const requirements = [];
    for (let index = 0; index < requirementCount; index += 1)
      requirements.push(await askNonempty(rl, `Requirement ${index + 1}: `));
    const answers = [];
    for (const option of options) {
      const row = [];
      for (const requirement of requirements)
        row.push(await askAnswer(rl, `Does "${option}" meet "${requirement}"? (y/n/?) `));
      answers.push(row);
    }
    return { objective, options, requirements, answers };
  } finally {
    rl.close();
  }
}

const input = example ? {
  objective: 'Choose a next step for a synthetic report',
  options: ['Review locally', 'Compare evidence', 'Publish now'],
  requirements: ['No external effect', 'Within approved scope'],
  answers: [['yes', 'yes'], ['yes', 'yes'], ['no', 'unknown']]
} : await interact();
const output = runWorksheet(input);
stdout.write(`\nPREFLIGHT (based on ${example ? 'synthetic example' : 'your self-reported answers'}): ${output.result.status}\n`);
for (const [index, candidate] of output.result.candidates.entries())
  stdout.write(`- ${output.option_labels[index]}: ${candidate.verdict}\n`);
if (output.result.status === 'SELECTION_REQUIRED')
  stdout.write('More than one option meets the stated requirements. Selection remains open.\n');
if (output.result.status === 'EVIDENCE_REQUIRED')
  stdout.write('At least one option needs a fact you marked unknown.\n');
stdout.write('This result does not verify your answers or authorize an action.\n');
if (save) {
  try {
    await mkdir(save);
    await Promise.all([
      ...['decision', 'policy', 'evidence'].map(name =>
        writeFile(resolve(save, `${name}.json`), `${JSON.stringify(output[name], null, 2)}\n`, { flag: 'wx' })),
      writeFile(resolve(save, 'worksheet.json'), `${JSON.stringify({
        note: 'Answers were self-reported; verify facts before using as a workflow gate.',
        objective: input.objective,
        option_labels: Object.fromEntries(input.options.map((name, index) => [`option_${index + 1}`, name])),
        requirement_labels: Object.fromEntries(input.requirements.map((name, index) => [`requirement_${index + 1}`, name]))
      }, null, 2)}\n`, { flag: 'wx' })
    ]);
    stdout.write(`Saved inputs and their plain-language labels to ${save}. Verify facts before using them as a workflow gate.\n`);
  } catch (error) {
    process.stderr.write(`Could not save worksheet: ${error.message}\n`);
    process.exitCode = 1;
  }
}
