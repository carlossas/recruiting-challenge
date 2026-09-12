import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Modules allowed to import the database handle. Everything else must go through a
 * repository, which is what guarantees the merchant scope can't be forgotten (TD-02, TD-04).
 */
const ALLOWED_DB_IMPORTERS = new Set(['src/dal/base-repository.ts']);

/** Standalone scripts are out of the request path and may use the handle directly. */
const EXCLUDED_PREFIXES = ['src/scripts/'];

/**
 * Whether a module imports the `db` handle itself. Importing `initSchema` (schema bootstrap)
 * from the same module is fine — what must stay contained is the connection.
 */
function importsDbHandle(source: string): boolean {
  const imports = source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*db\.js'/g);
  for (const match of imports) {
    const bindings = (match[1] ?? '').split(',').map((binding) => binding.trim().split(/\s+as\s+/)[0]?.trim());
    if (bindings.includes('db')) return true;
  }
  return false;
}

/** Lists every TypeScript file under a directory. */
function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

test('architecture: only the repository base class imports the database handle', () => {
  const offenders = listFiles('src')
    .map((path) => relative('src', path).split(sep).join('/'))
    .map((path) => `src/${path}`)
    .filter((path) => path !== 'src/db.ts')
    .filter((path) => !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .filter((path) => importsDbHandle(readFileSync(path, 'utf8')))
    .filter((path) => !ALLOWED_DB_IMPORTERS.has(path));

  assert.deepEqual(
    offenders,
    [],
    `these modules bypass the repository layer: ${offenders.join(', ')}. ` +
      'Extend BaseRepository (or AdminRepository) instead of importing db directly.',
  );
});

test('architecture: money math only happens inside the data-access layer', () => {
  // Refund semantics live in src/dal/money.ts. Aggregating amounts anywhere else is how the
  // "refunds count as income" bug (TD-05/TD-06) would come back on the next endpoint.
  const offenders = listFiles('src')
    .map((path) => relative('src', path).split(sep).join('/'))
    .map((path) => `src/${path}`)
    .filter((path) => !path.startsWith('src/dal/'))
    .filter((path) => /(?:SUM|AVG|TOTAL|COUNT)\s*\([^)]*total_amount/i.test(readFileSync(path, 'utf8')));

  assert.deepEqual(
    offenders,
    [],
    `these modules do money math outside the DAL: ${offenders.join(', ')}. ` +
      'Use the expressions in src/dal/money.ts through a repository instead.',
  );
});

test('architecture: routes do not open their own database connection', () => {
  const offenders = listFiles(join('src', 'routes')).filter((path) =>
    readFileSync(path, 'utf8').includes('better-sqlite3'),
  );
  assert.deepEqual(offenders, [], `routes must not talk to SQLite directly: ${offenders.join(', ')}`);
});
