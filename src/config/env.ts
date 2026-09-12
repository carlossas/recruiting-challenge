/**
 * Single source of configuration.
 *
 * Values come from the environment, optionally seeded from a `.env` file loaded with
 * Node's built-in `process.loadEnvFile()` (no `dotenv` dependency).
 *
 * `JWT_SECRET` is resolved lazily so that importing this module never touches the
 * filesystem: only code that actually signs or verifies a token can trigger the
 * "generate and persist a development secret" path.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

/** Default path of the environment file, relative to the working directory. */
export const ENV_FILE = '.env';

/** Runtime configuration other than the JWT secret. */
export interface Config {
  port: number;
  dbPath: string;
  adminTokenTtl: string;
  merchantTokenTtl: string;
  /** Whether local requests may be handed an admin session cookie automatically. */
  devAdminSession: boolean;
}

let envLoaded = false;

/**
 * Loads `.env` into `process.env` once, if the file exists. Existing variables win.
 *
 * @param envFile - Path to the environment file.
 */
export function loadEnv(envFile: string = ENV_FILE): void {
  if (envLoaded) return;
  envLoaded = true;
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/**
 * Reads the runtime configuration.
 */
export function getConfig(): Config {
  loadEnv();
  return {
    port: Number(process.env.PORT ?? 3000),
    dbPath: process.env.DB_PATH ?? 'data/dashboard.db',
    adminTokenTtl: process.env.ADMIN_TOKEN_TTL ?? '8h',
    merchantTokenTtl: process.env.MERCHANT_TOKEN_TTL ?? '10m',
    devAdminSession: (process.env.DEV_ADMIN_SESSION ?? 'on').toLowerCase() !== 'off',
  };
}

let cachedSecret: string | undefined;

/**
 * Returns the HS256 secret used to sign session tokens.
 *
 * If `JWT_SECRET` is not set, a random secret is generated and appended to `.env` so that
 * separate processes (the server and `npm run token`) share it. If the file can't be
 * written, this throws instead of silently signing with a throwaway value.
 *
 * @throws Error when no secret is configured and none can be persisted.
 */
export function getJwtSecret(): string {
  if (cachedSecret) return cachedSecret;
  loadEnv();
  const configured = process.env.JWT_SECRET;
  if (configured && configured.length > 0) {
    cachedSecret = configured;
    return cachedSecret;
  }
  cachedSecret = ensureGeneratedSecret(ENV_FILE);
  process.env.JWT_SECRET = cachedSecret;
  return cachedSecret;
}

/** Generates a random secret suitable for HS256. */
export function generateSecret(): string {
  return randomBytes(48).toString('hex');
}

/**
 * Returns the `JWT_SECRET` stored in an env file, generating and appending one when absent.
 *
 * @param envFile - Path to the environment file.
 * @throws Error when the file exists but can't be read, or can't be appended to.
 */
export function ensureGeneratedSecret(envFile: string): string {
  const secret = generateSecret();
  try {
    const existing = readEnvValue(envFile, 'JWT_SECRET');
    if (existing) return existing;
    const prefix = existsSync(envFile) ? '\n' : '';
    appendFileSync(envFile, `${prefix}JWT_SECRET=${secret}\n`, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `JWT_SECRET is not set and ${envFile} could not be written (${reason}). ` +
        'Set JWT_SECRET in the environment or run "npm run setup:env".',
    );
  }
  console.warn(`⚠ JWT_SECRET was missing: generated one and stored it in ${envFile}`);
  return secret;
}

/**
 * Reads a single `KEY=value` entry from an env file.
 *
 * @param envFile - Path to the environment file.
 * @param key - Variable name.
 * @returns The value, or `undefined` when the file or the key is missing.
 */
export function readEnvValue(envFile: string, key: string): string | undefined {
  if (!existsSync(envFile)) return undefined;
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    if (trimmed.slice(0, separator).trim() !== key) continue;
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** Resets memoized state. Tests only. */
export function resetEnvCacheForTests(): void {
  envLoaded = false;
  cachedSecret = undefined;
}
