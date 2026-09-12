/**
 * Per-request authentication context.
 *
 * Backed by `AsyncLocalStorage`, so any class or function reached during a request can read
 * the caller's identity without receiving it as a parameter. Repositories rely on this to
 * apply the merchant scope automatically.
 *
 * Reads fail closed: with no context established, `getAuthContext()` throws instead of
 * returning an unscoped default.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role, TokenScope } from './jwt.js';

/** Identity of the current caller. */
export interface AuthContext {
  role: Role;
  scope: TokenScope;
  /** Present for merchant callers only. */
  merchantId?: string;
}

/** Raised when code that needs an identity runs outside an authenticated request. */
export class MissingAuthContextError extends Error {
  constructor(message = 'no authentication context for this call') {
    super(message);
    this.name = 'MissingAuthContextError';
  }
}

const storage = new AsyncLocalStorage<AuthContext>();

/**
 * Runs a function with the given identity in scope, including across `await` boundaries.
 *
 * @param context - Identity of the caller.
 * @param fn - Work to run.
 */
export function runWithAuthContext<T>(context: AuthContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Returns the current caller's identity.
 *
 * @throws MissingAuthContextError when called outside an authenticated request.
 */
export function getAuthContext(): AuthContext {
  const context = storage.getStore();
  if (!context) throw new MissingAuthContextError();
  return context;
}

/**
 * Returns the current caller's identity, or `undefined` outside a request.
 */
export function tryGetAuthContext(): AuthContext | undefined {
  return storage.getStore();
}
