/**
 * Signing and verification of session tokens (HS256 JWT, via `jose`).
 *
 * Two kinds of token exist:
 * - **admin** (`scope: 'mint'`): may mint merchant tokens, may not read data.
 * - **merchant** (`scope: 'data'`): may read only its own merchant's data.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import { SignJWT, jwtVerify } from 'jose';
import { getConfig, getJwtSecret } from '../config/env.js';

/** Issuer claim of every token this app produces. */
export const TOKEN_ISSUER = 'recruiting-challenge';

/** Role of the caller. */
export type Role = 'merchant' | 'admin';

/** What a token is allowed to do. */
export type TokenScope = 'data' | 'mint';

/** Claims carried by a session token. */
export interface TokenClaims {
  role: Role;
  scope: TokenScope;
  /** Present only on merchant tokens. */
  merchantId?: string;
}

/** A verified token: its claims plus its expiry. */
export interface VerifiedToken extends TokenClaims {
  expiresAt: Date;
}

/** A freshly signed token. */
export interface IssuedToken extends VerifiedToken {
  token: string;
}

/** Raised when a token is missing, malformed, expired or signed with another key. */
export class InvalidTokenError extends Error {
  constructor(message = 'invalid token') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/**
 * Signs a token.
 *
 * @param claims - Claims to embed.
 * @param expiresIn - Lifetime in `jose` notation, e.g. `10m`, `8h`.
 */
export async function signToken(claims: TokenClaims, expiresIn: string): Promise<string> {
  const payload: Record<string, unknown> = { role: claims.role, scope: claims.scope };
  if (claims.merchantId) payload.merchantId = claims.merchantId;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(TOKEN_ISSUER)
    .setSubject(claims.merchantId ?? 'admin')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey());
}

/**
 * Verifies a token's signature, issuer, algorithm, expiry and claim shape.
 *
 * @param token - Encoded JWT.
 * @throws InvalidTokenError when the token can't be trusted.
 */
export async function verifyToken(token: string): Promise<VerifiedToken> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(), {
      issuer: TOKEN_ISSUER,
      algorithms: ['HS256'],
    }));
  } catch (error) {
    throw new InvalidTokenError(error instanceof Error ? error.message : 'invalid token');
  }

  const role = payload.role;
  const scope = payload.scope;
  const merchantId = payload.merchantId;

  if (role !== 'merchant' && role !== 'admin') throw new InvalidTokenError('unknown role claim');
  if (scope !== 'data' && scope !== 'mint') throw new InvalidTokenError('unknown scope claim');
  if (role === 'merchant' && typeof merchantId !== 'string') {
    throw new InvalidTokenError('merchant token without merchantId');
  }
  if (typeof payload.exp !== 'number') throw new InvalidTokenError('token without expiry');

  return {
    role,
    scope,
    ...(typeof merchantId === 'string' ? { merchantId } : {}),
    expiresAt: new Date(payload.exp * 1000),
  };
}

/**
 * Issues an admin (mint-scoped) token.
 *
 * @param expiresIn - Lifetime; defaults to `ADMIN_TOKEN_TTL`.
 */
export async function issueAdminToken(expiresIn: string = getConfig().adminTokenTtl): Promise<IssuedToken> {
  return issue({ role: 'admin', scope: 'mint' }, expiresIn);
}

/**
 * Issues a merchant (data-scoped) token.
 *
 * @param merchantId - Merchant the token is bound to.
 * @param expiresIn - Lifetime; defaults to `MERCHANT_TOKEN_TTL`.
 */
export async function issueMerchantToken(
  merchantId: string,
  expiresIn: string = getConfig().merchantTokenTtl,
): Promise<IssuedToken> {
  return issue({ role: 'merchant', scope: 'data', merchantId }, expiresIn);
}

/**
 * Signs a token and returns it together with its verified claims.
 */
async function issue(claims: TokenClaims, expiresIn: string): Promise<IssuedToken> {
  const token = await signToken(claims, expiresIn);
  const verified = await verifyToken(token);
  return { ...verified, token };
}

/**
 * The HS256 key derived from the configured secret.
 */
function secretKey(): Uint8Array {
  return new TextEncoder().encode(getJwtSecret());
}
