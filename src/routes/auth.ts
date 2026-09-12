/**
 * Session endpoints.
 *
 * The admin token is a minting credential: it exchanges itself for short-lived,
 * merchant-scoped tokens, one per merchant the dashboard switches to. Data endpoints only
 * ever accept merchant tokens, so the merchant id always comes from a token the backend
 * signed, never from the client.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import { Router } from 'express';
import {
  ADMIN_COOKIE,
  MERCHANT_COOKIE,
  parseCookies,
  secondsUntil,
  serializeClearedCookie,
  serializeSessionCookie,
} from '../auth/cookies.js';
import { requireAuth } from '../auth/guard.js';
import { InvalidTokenError, issueMerchantToken, verifyToken } from '../auth/jwt.js';
import { isLocalRequest } from '../auth/local.js';
import { merchantsRepository } from '../dal/merchants-repository.js';
import { asyncHandler } from './async-handler.js';

export const authRouter = Router();

/**
 * `POST /api/auth/token` — mints a merchant-scoped session for the requested merchant.
 * Requires an admin (mint-scoped) token.
 */
authRouter.post(
  '/token',
  requireAuth({ scope: 'mint' }),
  asyncHandler(async (req, res) => {
    const body = req.body as { merchantId?: unknown } | undefined;
    const merchantId = typeof body?.merchantId === 'string' ? body.merchantId : undefined;
    if (!merchantId) {
      res.status(400).json({ error: 'merchant_id_required' });
      return;
    }
    if (!merchantsRepository.exists(merchantId)) {
      res.status(404).json({ error: 'merchant_not_found' });
      return;
    }

    const { token, expiresAt } = await issueMerchantToken(merchantId);
    res.append(
      'Set-Cookie',
      serializeSessionCookie(MERCHANT_COOKIE, token, {
        maxAgeSeconds: secondsUntil(expiresAt),
        secure: !isLocalRequest(req),
      }),
    );
    res.status(204).end();
  }),
);

/**
 * `POST /api/auth/admin-session` — exchanges an admin token (from `npm run token`) for the
 * admin session cookie. The way in when the request isn't local.
 */
authRouter.post(
  '/admin-session',
  asyncHandler(async (req, res) => {
    const body = req.body as { token?: unknown } | undefined;
    const token = typeof body?.token === 'string' ? body.token : undefined;
    if (!token) {
      res.status(400).json({ error: 'token_required' });
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
    if (verified.scope !== 'mint') {
      res.status(403).json({ error: 'token_not_scoped_for_mint' });
      return;
    }

    res.append(
      'Set-Cookie',
      serializeSessionCookie(ADMIN_COOKIE, token, {
        maxAgeSeconds: secondsUntil(verified.expiresAt),
        secure: !isLocalRequest(req),
      }),
    );
    res.status(204).end();
  }),
);

/**
 * `GET /api/auth/session` — describes the current session so the dashboard knows what to render.
 */
authRouter.get(
  '/session',
  asyncHandler(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    for (const name of [MERCHANT_COOKIE, ADMIN_COOKIE]) {
      const token = cookies[name];
      if (!token) continue;
      try {
        const verified = await verifyToken(token);
        res.json({
          role: verified.role,
          scope: verified.scope,
          merchantId: verified.merchantId ?? null,
          expiresAt: verified.expiresAt.toISOString(),
        });
        return;
      } catch (error) {
        if (!(error instanceof InvalidTokenError)) throw error;
      }
    }
    res.status(401).json({ error: 'unauthenticated' });
  }),
);

/**
 * `DELETE /api/auth/session` — clears both session cookies.
 */
authRouter.delete('/session', (_req, res) => {
  res.append('Set-Cookie', serializeClearedCookie(MERCHANT_COOKIE));
  res.append('Set-Cookie', serializeClearedCookie(ADMIN_COOKIE));
  res.status(204).end();
});
