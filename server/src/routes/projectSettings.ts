import { Router, json } from 'express';
import type { ProjectRoot } from '../project.js';
import { CredentialStore } from '../credentials.js';
import { readProjectManifest, writeProjectManifest } from '../projectConfig.js';
import { createBrowserCapabilityBoundary, isLoopbackHost, type ServerSecurityOptions } from '../security.js';

export function createProjectSettingsRouter(project: ProjectRoot, security: ServerSecurityOptions, credentials = new CredentialStore()): Router {
  const router = Router();
  if (!isLoopbackHost(security.host)) return router.use((_req, res) => res.status(404).end());
  const boundary = createBrowserCapabilityBoundary(security, 'Project settings', 'X-Cascade-Project-Capability');
  router.use(boundary.guardOrigin);
  router.options('{*path}', boundary.preflight);
  router.get('/capability', boundary.issueCapability);
  router.get('/', boundary.requireCapability, (_req, res) => {
    try { res.json(publicProjectState(project, credentials)); }
    catch (error) { res.status(500).json({ ok: false, error: message(error) }); }
  });
  router.put('/', boundary.requireCapability, json({ limit: '1mb' }), (req, res) => {
    try {
      writeProjectManifest(project.root, req.body);
      res.json(publicProjectState(project, credentials));
    } catch (error) {
      res.status(400).json({ ok: false, error: message(error) });
    }
  });
  return router;
}

function publicProjectState(project: ProjectRoot, credentials: CredentialStore) {
  const manifest = readProjectManifest(project.root);
  const requiredCredentials = manifest.credentials.map((name) => ({ name, set: credentials.has(name) }));
  return { ok: true, manifest, requiredCredentials, missingCredentials: requiredCredentials.filter((item) => !item.set).map((item) => item.name) };
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
