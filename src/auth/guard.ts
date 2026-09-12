/**
 * Route guard.
 *
 * Reads the session cookie, verifies the token, enforces the scope rules, and runs the rest
 * of the request inside an {@link AuthContext}. Can be applied to a whole router or a single
 * route, so new routes are protected by adding one middleware.
 *
 * Rules:
 * - no token → `401 unauthenticated`
 * - invalid/expired token → `401 session_expired`
 * - admin token on a data route → `403 token_not_scoped_for_data`
 * - merchant token on a mint route → `403 token_not_scoped_for_mint`
 * - `X-Merchant-Id` different from the token's merchant → `403 merchant_mismatch`
 *
 * The client-supplied merchant id is never used, only compared: the token always wins.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ADMIN_COOKIE, MERCHANT_COOKIE, parseCookies } from './cookies.js';
import { runWithAuthContext } from './context.js';
import { InvalidTokenError, verifyToken, type TokenScope } from './jwt.js';

/** Options accepted by {@link requireAuth}. */
export interface GuardOptions {
  /** Scope the caller's token must carry. Defaults to `data`. */
  scope?: TokenScope;
}

/**
 * Builds the authentication middleware.
 *
 * @param options - Required scope.
 */
export function requireAuth(options: GuardOptions = {}): RequestHandler {
  const scope = options.scope ?? 'data';
  return (req, res, next) => {
    authenticate(req, res, next, scope).catch(next);
  };
}

/**
 * Verifies the request's token and establishes the auth context.
 */
async function authenticate(req: Request, res: Response, next: NextFunction, scope: TokenScope): Promise<void> {
  const token = extractToken(req, scope);
  if (!token) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }

  let verified;
  try {
    verified = await verifyToken(token);
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      res.status(401).json({ error: 'session_expired' });
      return;
    }
    throw error;
  }

  if (verified.scope !== scope) {
    res.status(403).json({
      error: scope === 'data' ? 'token_not_scoped_for_data' : 'token_not_scoped_for_mint',
    });
    return;
  }

  if (scope === 'data') {
    const requested = req.header('X-Merchant-Id');
    if (requested && requested !== verified.merchantId) {
      res.status(403).json({ error: 'merchant_mismatch' });
      return;
    }
  }

  runWithAuthContext(
    {
      role: verified.role,
      scope: verified.scope,
      ...(verified.merchantId ? { merchantId: verified.merchantId } : {}),
    },
    next,
  );
}

/**
 * Picks the credential for the requested scope: the admin cookie (or a bearer token) for
 * minting, the merchant cookie for data.
 */
function extractToken(req: Request, scope: TokenScope): string | undefined {
  const cookies = parseCookies(req.headers.cookie);
  const preferred = scope === 'mint' ? ADMIN_COOKIE : MERCHANT_COOKIE;
  const fallback = scope === 'mint' ? MERCHANT_COOKIE : ADMIN_COOKIE;
  // The fallback is picked up on purpose: presenting the wrong kind of token must be
  // reported as a scope problem (403), not as a missing session (401).
  return bearerToken(req) ?? cookies[preferred] ?? cookies[fallback];
}

/**
 * Extracts an `Authorization: Bearer <token>` value, if present.
 */
function bearerToken(req: Request): string | undefined {
  const header = req.header('Authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return undefined;
  const token = header.slice('bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}
