/**
 * Issues an admin (mint-scoped) token.
 *
 * Merchant tokens are not issued here on purpose: they come from `POST /api/auth/token`, so
 * their `merchantId` claim is always decided by the backend.
 *
 * Usage:
 *   npm run token
 *   npm run token -- expiresIn=30m
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import { getConfig } from '../config/env.js';
import { issueAdminToken } from '../auth/jwt.js';

/**
 * Parses `key=value` command-line arguments.
 *
 * @param argv - Raw arguments (without the node/script entries).
 */
export function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const raw of argv) {
    const arg = raw.startsWith('--') ? raw.slice(2) : raw;
    const separator = arg.indexOf('=');
    if (separator === -1) continue;
    args[arg.slice(0, separator).trim()] = arg.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
  }
  return args;
}

/**
 * Issues the token and prints it with usage hints.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const expiresIn = args.expiresIn ?? getConfig().adminTokenTtl;

  const { token, expiresAt } = await issueAdminToken(expiresIn);

  console.log(token);
  console.log();
  console.log(`role: admin · scope: mint · expires: ${expiresAt.toISOString()}`);
  console.log('Exchange it for the admin session cookie:');
  console.log(
    `  curl -i -X POST http://localhost:${getConfig().port}/api/auth/admin-session ` +
      `-H "Content-Type: application/json" -d '{"token":"${token}"}'`,
  );
}

await main();
