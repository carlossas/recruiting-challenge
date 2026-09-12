/**
 * Detection of local (loopback) requests.
 *
 * Used to decide whether a request may be handed an admin session cookie automatically,
 * and whether session cookies can skip the `Secure` attribute.
 *
 * The authoritative signal is the **TCP peer address**, which a remote client cannot forge.
 * The `Host` header is only a secondary guard: it is client-supplied, so `Host: localhost`
 * sent from another machine must not be enough. `X-Forwarded-*` headers are ignored on
 * purpose — a proxy could set them to anything.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import type { Request } from 'express';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Whether a socket address belongs to the loopback interface.
 *
 * @param address - Remote address of the connection, e.g. `::ffff:127.0.0.1`.
 */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  if (normalized === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

/**
 * Whether a `Host` header points at localhost. Port and IPv6 brackets are stripped.
 *
 * @param host - Raw `Host` header value.
 */
export function isLocalHostname(host: string | undefined | null): boolean {
  if (!host) return false;
  const withoutPort = host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : (host.split(':')[0] ?? '');
  return LOOPBACK_HOSTNAMES.has(withoutPort.toLowerCase());
}

/**
 * Whether a connection is local: loopback peer address **and** a localhost `Host` header.
 *
 * @param remoteAddress - Peer address from the socket.
 * @param host - `Host` header sent by the client.
 */
export function isLocalConnection(remoteAddress: string | undefined | null, host: string | undefined | null): boolean {
  return isLoopbackAddress(remoteAddress) && isLocalHostname(host);
}

/**
 * Whether an Express request came from the local machine.
 *
 * @param req - Incoming request.
 */
export function isLocalRequest(req: Request): boolean {
  return isLocalConnection(req.socket.remoteAddress, req.headers.host);
}
