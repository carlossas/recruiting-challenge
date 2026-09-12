/**
 * Creates `.env` from `.env.example` and makes sure it carries a `JWT_SECRET`.
 *
 * Idempotent: an existing `.env` is never overwritten, and an existing secret is kept.
 *
 * Usage: npm run setup:env
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import { copyFileSync, existsSync } from 'node:fs';
import { ENV_FILE, ensureGeneratedSecret, readEnvValue } from '../config/env.js';

const EXAMPLE_FILE = '.env.example';

/**
 * Ensures `.env` exists and contains a secret.
 */
function main(): void {
  const hadEnvFile = existsSync(ENV_FILE);
  if (!hadEnvFile) {
    if (!existsSync(EXAMPLE_FILE)) {
      throw new Error(`${EXAMPLE_FILE} is missing; cannot create ${ENV_FILE}`);
    }
    copyFileSync(EXAMPLE_FILE, ENV_FILE);
    console.log(`created ${ENV_FILE} from ${EXAMPLE_FILE}`);
  }

  const existingSecret = readEnvValue(ENV_FILE, 'JWT_SECRET');
  ensureGeneratedSecret(ENV_FILE);
  console.log(existingSecret ? 'JWT_SECRET already set — kept as is' : `JWT_SECRET generated and written to ${ENV_FILE}`);
}

main();
