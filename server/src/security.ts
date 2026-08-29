import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface ServerSecurityOptions {
  readonly host: string;
  readonly port: number;
  readonly trustedOrigins: readonly string[];
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
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
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
      if (!host || !authorities.has(host) || origin === 'null' || (origin && !origins.has(origin))) {
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
      if (!origin || origin === 'null' || !origins.has(origin) || !host || !authorities.has(host)) {
        res.status(403).json({ ok: false, error: `${label} access denied` });
        return;
      }
      setCorsOrigin(res, origin);
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

function allowedAuthorities(options: ServerSecurityOptions, origins: ReadonlySet<string>): Set<string> {
  const authorities = new Set([...origins].map((origin) => new URL(origin).host));
  if (options.host === '127.0.0.1' || options.host === 'localhost') {
    authorities.add(`127.0.0.1:${options.port}`);
    authorities.add(`localhost:${options.port}`);
  } else if (options.host.includes(':')) {
    authorities.add(`[${options.host}]:${options.port}`);
  } else {
    authorities.add(`${options.host}:${options.port}`);
  }
  return authorities;
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
