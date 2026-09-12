import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureGeneratedSecret, generateSecret, readEnvValue } from '../src/config/env.js';

/** Creates an isolated directory for env-file tests. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'env-test-'));
}

test('env: generates a secret and persists it so other processes share it', () => {
  const envFile = join(tempDir(), '.env');
  const secret = ensureGeneratedSecret(envFile);

  assert.ok(secret.length >= 32);
  assert.equal(readEnvValue(envFile, 'JWT_SECRET'), secret);
  assert.match(readFileSync(envFile, 'utf8'), /^JWT_SECRET=/m);
});

test('env: keeps an existing secret instead of rotating it', () => {
  const envFile = join(tempDir(), '.env');
  writeFileSync(envFile, '# comment\nPORT=3000\nJWT_SECRET=already-set\n', 'utf8');

  assert.equal(ensureGeneratedSecret(envFile), 'already-set');
  assert.equal(ensureGeneratedSecret(envFile), 'already-set');
});

test('env: an empty assignment counts as missing', () => {
  const envFile = join(tempDir(), '.env');
  writeFileSync(envFile, 'JWT_SECRET=\n', 'utf8');

  assert.equal(readEnvValue(envFile, 'JWT_SECRET'), undefined);
  assert.ok(ensureGeneratedSecret(envFile).length >= 32);
});

test('env: fails loudly when the file cannot be written', () => {
  // A directory path can't be appended to as a file.
  const directory = tempDir();
  assert.throws(() => ensureGeneratedSecret(directory), /could not be written|setup:env/);
});

test('env: generated secrets are unique', () => {
  assert.notEqual(generateSecret(), generateSecret());
});
