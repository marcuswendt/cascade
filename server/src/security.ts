import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

export interface ServerSecurityOptions {
  readonly host: string;
  readonly port: number;
  readonly trustedOrigins: readonly string[];
  readonly trustedHosts: readonly string[];
  readonly sensitiveCapabilities: boolean;
}

export interface BrowserCapabilityBoundary {
  readonly guardOrigin: (req: Request, res: Response, next: NextFunction) => void;
  readonly preflight: (req: Request, res: Response) => void;
  readonly issueCapability: (_req: Request, res: Response) => void;
  readonly requireCapability: (req: Request, res: Response, next: NextFunction) => void;
}

export interface ProjectRequestBoundary {
  readonly guard: (req: Request, res: Response, next: NextFunction) => void;
  readonly preflight: (req: Request, res: Response) => void;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

export function allowsSensitiveCapabilities(options: ServerSecurityOptions): boolean {
  return options.sensitiveCapabilities;
}

/**
 * Protect every project API from browser cross-origin requests and DNS
 * rebinding. Same-origin GET requests do not consistently carry Origin, so an
 * exact Host is always required while Origin is validated whenever present.
 */
export function createProjectRequestBoundary(options: ServerSecurityOptions): ProjectRequestBoundary {
  const origins = new Set(options.trustedOrigins.map((origin) => validateOrigin(origin, 'Project')));
  const authorities = allowedAuthorities(options, origins);

  return {
    guard(req, res, next) {
      const host = req.get('Host');
      const origin = req.get('Origin');
      if (!host || !authorities.has(host.toLowerCase()) || origin === 'null' || (origin && !origins.has(origin))) {
        res.status(403).json({ ok: false, error: 'Project access denied' });
        return;
      }
      if (origin) setCorsOrigin(res, origin);
      next();
    },
    preflight(req, res) {
      const origin = req.get('Origin');
      if (origin) setCorsOrigin(res, origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.status(204).end();
    },
  };
}

export function createBrowserCapabilityBoundary(
  options: ServerSecurityOptions,
  label: string,
  header: string,
): BrowserCapabilityBoundary {
  const origins = new Set(options.trustedOrigins.map((origin) => validateOrigin(origin, label)));
  const authorities = allowedAuthorities(options, origins);
  const capability = randomBytes(32).toString('base64url');
  const expectedBytes = Buffer.from(capability);

  return {
    guardOrigin(req, res, next) {
      const origin = req.get('Origin');
      const host = req.get('Host');
      if (!host || !authorities.has(host.toLowerCase()) || origin === 'null' || (origin && !origins.has(origin))) {
        res.status(403).json({ ok: false, error: `${label} access denied` });
        return;
      }
      if (origin) setCorsOrigin(res, origin);
      next();
    },
    preflight(_req, res) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${header}`);
      res.status(204).end();
    },
    issueCapability(_req, res) {
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('Pragma', 'no-cache');
      res.json({ capability });
    },
    requireCapability(req, res, next) {
      const supplied = req.get(header);
      const suppliedBytes = supplied ? Buffer.from(supplied) : Buffer.alloc(0);
      if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
        res.status(403).json({ ok: false, error: `${label} capability required` });
        return;
      }
      next();
    },
  };
}

/**
 * The `Host` values this server will answer API requests for.
 *
 * **The host it is bound to is always one of them.** It used to be added only
 * when `trustedHosts` was empty, so naming a trusted host *replaced* the bind
 * host instead of adding to it — and on 2026-09-08 that took Marcus's Studios
 * out from under him. They run as `--host KURO --trusted-host
 * kuro.hydra-diatonic.ts.net`, so the moment the tailnet name was trusted,
 * `http://kuro:3030` began answering **403 on every API call while still
 * serving the page**, which reads as a broken app rather than as a host rule.
 *
 * Nobody adds a trusted host meaning "and stop trusting the one I am serving
 * on". Trusted hosts are additive; that is what the name says.
 *
 * A wildcard bind address is the exception and stays excluded. `0.0.0.0` and
 * `::` mean "every interface", not a name a browser will ever send, so
 * admitting them would allow a `Host` header nobody serves under.
 *
 * Exported for testing: binding to a real hostname is not portable in a test,
 * and the rule is worth checking without a socket.
 */
export function allowedAuthorities(options: ServerSecurityOptions, origins: ReadonlySet<string>): Set<string> {
  const authorities = new Set([...origins].map((origin) => new URL(origin).host.toLowerCase()));
  if (isLoopbackHost(options.host)) {
    authorities.add(`127.0.0.1:${options.port}`);
    authorities.add(`localhost:${options.port}`);
  } else if (!isWildcardHost(options.host)) {
    authorities.add(authority(options.host, options.port));
  }
  for (const host of options.trustedHosts) authorities.add(trustedAuthority(host, options.port));
  return authorities;
}

/** `0.0.0.0` / `::` — a bind wildcard, never a hostname a client sends. */
export function isWildcardHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '*';
}

/**
 * A trusted host's authority, honouring a port written into the value.
 *
 * Behind a reverse proxy the public port is not the bind port: measured with
 * `tailscale serve` on 2026-09-08, a request to
 * `https://kuro.hydra-diatonic.ts.net:8444` reaches a loopback backend with
 * **`Host: kuro.hydra-diatonic.ts.net:8444` verbatim, port included.** So an
 * allowlist built from the *bind* port would still refuse it, and the fix for
 * the 403 would look like it had not worked.
 *
 * `--trusted-host name:port` therefore names the authority a browser will
 * actually send. Without a port it falls back to the server's own, which is
 * the direct-access case and stays the common one.
 */
export function trustedAuthority(value: string, defaultPort: number): string {
  const trimmed = value.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(trimmed);
  if (bracketed) return authority(`[${bracketed[1]}]`, checkedPort(bracketed[2]));
  const hostAndPort = /^([^:]+):(\d+)$/.exec(trimmed);
  if (hostAndPort) return authority(hostAndPort[1], checkedPort(hostAndPort[2]));
  return authority(trimmed, defaultPort);
}

function checkedPort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid trusted host port: ${raw}`);
  }
  return port;
}

export function authority(host: string, port: number): string {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized || /[\s/?#@]/.test(normalized)) throw new Error(`Invalid trusted host: ${host}`);
  if (normalized.includes(':') && isIP(normalized) !== 6) throw new Error(`Invalid trusted host: ${host}`);
  return `${normalized.includes(':') ? `[${normalized}]` : normalized}:${port}`;
}

function setCorsOrigin(res: Response, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
}

function validateOrigin(value: string, label: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Invalid trusted ${label.toLowerCase()} origin: ${value}`);
  }
  return url.origin;
}
