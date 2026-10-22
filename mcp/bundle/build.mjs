#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const manifestPath = fileURLToPath(new URL('./manifest.json', import.meta.url));
const readJson = async filename => JSON.parse(await readFile(filename, 'utf8'));
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

function requireOutsideRepository(filename) {
  if (inside(repositoryRoot, filename)) {
    throw new Error('Bundle staging and output must be outside the repository checkout.');
  }
}

async function requireAbsent(filename) {
  try {
    await lstat(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Refusing to overwrite existing path: ${filename}`);
}

async function copyDependency(source, destination) {
  await cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: async filename => {
      // Each nested dependency is copied from its own production lockfile entry.
      if (filename !== source && path.basename(filename) === 'node_modules') return false;
      if ((await lstat(filename)).isSymbolicLink()) {
        throw new Error(`Dependency symlinks are not supported; reinstall from the lockfile: ${filename}`);
      }
      return true;
    }
  });
}

export async function prepareBundle({ stageDir }) {
  if (!stageDir) throw new Error('stageDir is required.');
  stageDir = path.resolve(stageDir);
  requireOutsideRepository(stageDir);
  await requireAbsent(stageDir);
  const [manifest, mcpPackage, lock] = await Promise.all([
    readJson(manifestPath),
    readJson(path.join(repositoryRoot, 'mcp/package.json')),
    readJson(path.join(repositoryRoot, 'mcp/package-lock.json'))
  ]);
  if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error('A version 3 MCP package lockfile is required.');
  if (manifest.version !== mcpPackage.version || lock.packages[''].version !== mcpPackage.version) {
    throw new Error('Bundle, MCP package and lockfile versions must match.');
  }
  if (JSON.stringify(mcpPackage.dependencies) !== JSON.stringify(lock.packages[''].dependencies)) {
    throw new Error('MCP package runtime dependencies differ from the lockfile; run npm ci first.');
  }

  const dependencies = Object.entries(lock.packages).filter(([relative, item]) => relative && !item.dev);
  // Validate the local installation before creating any distribution files.
  for (const [relative, item] of dependencies) {
    if (!relative.startsWith('node_modules/') || relative.split('/').includes('..') || item.link) {
      throw new Error(`Unsupported package lockfile path: ${relative}`);
    }
    const installed = await readJson(path.join(repositoryRoot, 'mcp', relative, 'package.json'));
    if (installed.version !== item.version) throw new Error(`Installed dependency differs from lockfile: ${relative}`);
  }

  await mkdir(path.dirname(stageDir), { recursive: true });
  await mkdir(stageDir);
  await mkdir(path.join(stageDir, 'src'));
  await mkdir(path.join(stageDir, 'mcp/bin'), { recursive: true });
  await mkdir(path.join(stageDir, 'mcp/src'), { recursive: true });
  // Preserve the existing relative core import and copy its exact bytes.
  for (const relative of ['LICENSE', 'src/preflight.mjs', 'mcp/bin/server.mjs', 'mcp/src/server.mjs']) {
    await cp(path.join(repositoryRoot, relative), path.join(stageDir, relative), { errorOnExist: true, force: false });
  }
  const { devDependencies, scripts, ...runtimePackage } = mcpPackage;
  await writeFile(path.join(stageDir, 'mcp/package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`);
  await writeFile(path.join(stageDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [relative] of dependencies) {
    await copyDependency(path.join(repositoryRoot, 'mcp', relative), path.join(stageDir, 'mcp', relative));
  }
  return { stageDir, version: manifest.version, productionPackages: dependencies.length };
}

export async function buildBundle({ stageDir, outputPath, mcpbCli }) {
  if (!outputPath || !mcpbCli) throw new Error('outputPath and mcpbCli are required.');
  outputPath = path.resolve(outputPath);
  mcpbCli = path.resolve(mcpbCli);
  requireOutsideRepository(outputPath);
  if (!outputPath.endsWith('.mcpb')) throw new Error('The output filename must end with .mcpb.');
  if (stageDir && inside(path.resolve(stageDir), outputPath)) throw new Error('Output must be outside the staging directory.');
  await requireAbsent(outputPath);
  const cliPackage = await readJson(path.resolve(path.dirname(mcpbCli), '../../package.json'));
  if (cliPackage.name !== '@anthropic-ai/mcpb') throw new Error('Use the official @anthropic-ai/mcpb dist/cli/cli.js entry point.');
  const prepared = await prepareBundle({ stageDir });
  await mkdir(path.dirname(outputPath), { recursive: true });
  for (const args of [['validate', path.join(prepared.stageDir, 'manifest.json')], ['pack', prepared.stageDir, outputPath]]) {
    const result = spawnSync(process.execPath, [mcpbCli, ...args], { stdio: 'inherit', cwd: prepared.stageDir });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Official MCPB ${args[0]} failed with exit code ${result.status}.`);
  }
  const fileSha256 = createHash('sha256').update(await readFile(outputPath)).digest('hex');
  return { ...prepared, outputPath, fileSha256, mcpbVersion: cliPackage.version, releaseTag: `mcp-v${prepared.version}` };
}

async function main() {
  const options = {};
  const keys = { '--stage': 'stageDir', '--output': 'outputPath', '--mcpb-cli': 'mcpbCli' };
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = keys[process.argv[index]];
    const value = process.argv[index + 1];
    if (!key || !value || value.startsWith('--')) throw new Error('Usage: node mcp/bundle/build.mjs --stage <new-directory> --output <file.mcpb> --mcpb-cli <official dist/cli/cli.js>');
    options[key] = value;
  }
  console.log(JSON.stringify(await buildBundle(options), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
