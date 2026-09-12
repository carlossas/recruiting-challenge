/**
 * Local development bootstrap: hands an admin session cookie to local requests.
 *
 * This exists so `npm run dev` works without a manual login step. It is deliberately gated on
 * {@link isLocalRequest} — the TCP peer address must be loopback, which a remote client cannot
 * forge — and can be switched off with `DEV_ADMIN_SESSION=off`.
 *
 * Anything that lets an arbitrary caller obtain a minting credential is an authentication
 * bypass. Do not relax this gate; in a deployed environment the admin token must come from a
 * real login or from `npm run token`.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import type { Request, RequestHandler, Response } from 'express';
import { getConfig } from '../config/env.js';
import { ADMIN_COOKIE, parseCookies, secondsUntil, serializeSessionCookie } from './cookies.js';
import { issueAdminToken } from './jwt.js';
import { isLocalRequest } from './local.js';

/**
 * Builds the middleware. A no-op when `DEV_ADMIN_SESSION=off`.
 */
export function devAdminSession(): RequestHandler {
  if (!getConfig().devAdminSession) return (_req, _res, next) => next();

  return (req, res, next) => {
    attachAdminSession(req, res).then(() => next(), next);
  };
}

/**
 * Mints an admin token for a local request that doesn't have one yet, setting it both on the
 * response (for later requests) and on the current request (so this one is already usable).
 */
async function attachAdminSession(req: Request, res: Response): Promise<void> {
  if (!isLocalRequest(req)) return;
  if (parseCookies(req.headers.cookie)[ADMIN_COOKIE]) return;

  const { token, expiresAt } = await issueAdminToken();
  res.append(
    'Set-Cookie',
    serializeSessionCookie(ADMIN_COOKIE, token, {
      maxAgeSeconds: secondsUntil(expiresAt),
      secure: false,
    }),
  );
  req.headers.cookie = [req.headers.cookie, `${ADMIN_COOKIE}=${encodeURIComponent(token)}`]
    .filter(Boolean)
    .join('; ');
}
