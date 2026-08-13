import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const launcher = resolve(scriptDirectory, 'record_site_demo.sh');
const testDirectory = await mkdtemp(join(tmpdir(), 'automated-site-demo-cli-'));
const planPath = join(testDirectory, 'plan.json');

const plan = {
  name: 'CLI test',
  slug: 'cli-test',
  segments: [
    {
      name: 'Validation only',
      viewport: { width: 1280, height: 720 },
      startPath: '/',
      actions: [],
    },
  ],
};

try {
  await writeFile(planPath, `${JSON.stringify(plan)}\n`);

  expectSuccess([
    '--plan', planPath,
    '--base-url', 'http://127.0.0.1:4173',
    '--site-root', testDirectory,
    '--output-dir', testDirectory,
    '--validate',
  ], 'split value options');
  expectSuccess([
    `--plan=${planPath}`,
    '--base-url=http://127.0.0.1:4173',
    `--site-root=${testDirectory}`,
    `--output-dir=${testDirectory}`,
    '--validate',
  ], 'equals value options');
  expectSuccess(['--help'], 'long help option', 'Value options accept both');
  expectSuccess(['-h'], 'short help option', 'Usage:');
  expectFailure(['--plan', '--validate'], 'missing plan value', '--plan requires a value.');
  expectFailure(['--plan', '-h', '--validate'], 'short option used as a value', '--plan requires a value.');
  expectFailure(['--unknown', '--validate'], 'unknown option', 'Unknown option: --unknown');

  console.log('CLI regression tests passed.');
} finally {
  await rm(testDirectory, { recursive: true, force: true });
}

function run(argumentsList) {
  return spawnSync('bash', [launcher, ...argumentsList], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function expectSuccess(argumentsList, label, expectedText = 'Demo plan is valid:') {
  const result = run(argumentsList);
  assert.equal(result.status, 0, `${label} failed:\n${result.stderr}`);
  assert.match(result.stdout, new RegExp(escapePattern(expectedText)), `${label} output was unexpected.`);
}

function expectFailure(argumentsList, label, expectedText) {
  const result = run(argumentsList);
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded.`);
  assert.match(result.stderr, new RegExp(escapePattern(expectedText)), `${label} diagnostic was unexpected.`);
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
