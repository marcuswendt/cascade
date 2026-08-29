import { Router, json } from 'express';
import type { ProjectRoot } from '../project.js';
import { CredentialStore, secretValue } from '../credentials.js';
import { readProjectManifest } from '../projectConfig.js';
import { createBrowserCapabilityBoundary, isLoopbackHost, type ServerSecurityOptions } from '../security.js';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const BLOCKED_HEADER = /^(?:authorization|cookie|host|origin|referer|proxy-|sec-)/i;

export function createNetRouter(project: ProjectRoot, security: ServerSecurityOptions, credentials = new CredentialStore()): Router {
  const router = Router();
  if (!isLoopbackHost(security.host)) return router.use((_req, res) => res.status(404).end());
  const boundary = createBrowserCapabilityBoundary(security, 'Authorized fetch', 'X-Cascade-Net-Capability');
  router.use(boundary.guardOrigin);
  router.options('{*path}', boundary.preflight);
  router.get('/capability', boundary.issueCapability);
  router.post('/', boundary.requireCapability, json({ limit: '16mb' }), async (req, res) => {
    try {
      res.json(await authorizedProxyRequest(project, credentials, req.body));
    } catch (error) {
      const status = typeof (error as any)?.status === 'number' ? (error as any).status : 400;
      res.status(status).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  return router;
}

export async function authorizedProxyRequest(
  project: ProjectRoot,
  credentials: CredentialStore,
  input: unknown,
  fetcher: typeof fetch = fetch,
) {
  const request = parseRequest(input);
  const manifest = readProjectManifest(project.root);
  if (!manifest.credentials.includes(request.credential)) throw statusError(403, `Credential ${JSON.stringify(request.credential)} is not declared in cascade.json`);
  const definition = credentials.get(request.credential);
  if (!definition) throw statusError(424, `Credential ${JSON.stringify(request.credential)} is not set`);
  const secret = secretValue(definition);
  if (!secret || !definition.header || definition.hosts.length === 0) throw statusError(400, `Credential ${JSON.stringify(request.credential)} needs field/header/hosts metadata for browser proxy use`);
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || url.username || url.password || !definition.hosts.includes(url.hostname.toLowerCase())) {
    throw statusError(403, `Credential ${JSON.stringify(request.credential)} is not authorized for ${url.hostname}`);
  }
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (BLOCKED_HEADER.test(name)) headers.delete(name);
  headers.set(definition.header, definition.scheme ? `${definition.scheme} ${secret}` : secret);
  const response = await fetcher(url, { method: request.method, headers, body: request.body, redirect: 'manual' });
  const body = await response.text();
  return { ok: true as const, status: response.status, statusText: response.statusText,
    headers: { 'content-type': response.headers.get('content-type') ?? 'text/plain' }, body };
}

function parseRequest(input: unknown): { credential: string; url: string; method: string; headers: Record<string, string>; body?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('body must be an object');
  const value = input as Record<string, unknown>;
  if (typeof value.credential !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.credential)) throw new Error('credential is invalid');
  if (typeof value.url !== 'string') throw new Error('url is required');
  const method = typeof value.method === 'string' ? value.method.toUpperCase() : 'GET';
  if (!ALLOWED_METHODS.has(method)) throw new Error('method is not supported');
  if (value.body !== undefined && typeof value.body !== 'string') throw new Error('body must be a string');
  const headers = value.headers === undefined ? {} : value.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.values(headers).some((item) => typeof item !== 'string')) throw new Error('headers must be an object of strings');
  return { credential: value.credential, url: value.url, method, headers: headers as Record<string, string>, ...(typeof value.body === 'string' ? { body: value.body } : {}) };
}

function statusError(status: number, message: string): Error { return Object.assign(new Error(message), { status }); }
