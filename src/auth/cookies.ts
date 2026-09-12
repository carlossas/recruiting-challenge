/**
 * Minimal cookie helpers.
 *
 * Session tokens are signed JWTs, so the cookie itself needs no integrity protection —
 * a dedicated cookie library would only add a dependency.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */

/** Cookie holding the admin (mint-scoped) token. */
export const ADMIN_COOKIE = 'admin_session';

/** Cookie holding the merchant (data-scoped) token. */
export const MERCHANT_COOKIE = 'merchant_session';

/** Attributes applied when writing a session cookie. */
export interface SessionCookieOptions {
  /** Cookie lifetime in seconds. */
  maxAgeSeconds: number;
  /** Whether to mark the cookie `Secure` (off for plain-HTTP local development). */
  secure: boolean;
}

/**
 * Parses a `Cookie` header into a map. Unknown or malformed pairs are skipped.
 *
 * @param header - Raw `Cookie` header value.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return cookies;
}

/**
 * Serializes a session cookie: `HttpOnly`, `SameSite=Strict`, `Path=/`.
 *
 * @param name - Cookie name.
 * @param value - Token to store.
 * @param options - Lifetime and `Secure` flag.
 */
export function serializeSessionCookie(name: string, value: string, options: SessionCookieOptions): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

/**
 * Serializes a cookie that clears a previously set session cookie.
 *
 * @param name - Cookie name.
 */
export function serializeClearedCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/**
 * Seconds remaining until an expiry date, never negative.
 *
 * @param expiresAt - Expiry instant.
 */
export function secondsUntil(expiresAt: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
}
