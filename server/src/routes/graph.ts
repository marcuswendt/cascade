/**
 * Graph routes — replaces the old multi-project routes/projects.ts
 * entirely (round 32 re-scope: one server instance, one project, the
 * directory `cascade` was launched in). Everything here is scoped to the
 * single ProjectRoot passed in at server startup (see cli.ts), never a
 * `:project` URL param — there is no other project to accidentally reach.
 */
import { Router } from 'express';
import type { ProjectRoot } from '../project.js';
import { PathSafetyError } from '../pathSafety.js';
import { formatCompactJSON } from '../formatCascadeJson.js';
import { autoCommit, listFileVersions, isFileDirty, readFileAtVersion } from '../git.js';

function handleError(res: import('express').Response, err: unknown) {
  if (err instanceof PathSafetyError) {
    res.status(400).json({ error: err.message });
    return;
  }
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') {
    res.status(404).json({ error: 'not found' });
    return;
  }
  console.error('[graph route] error:', err);
  res.status(500).json({ error: String(err) });
}

export function createGraphRouter(project: ProjectRoot): Router {
  const router = Router();

  // List every *.cascade file at the project root — may be one (the
  // common case) or several (a project can have more than one graph,
  // e.g. multiple conversation/scene files side by side).
  router.get('/', async (_req, res) => {
    try {
      res.json({
        root: project.root,
        isGitRepo: project.isGitRepo,
        graphs: await project.listGraphFiles(),
        default: await project.resolveDefaultGraph(),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/:filename', async (req, res) => {
    try {
      const content = await project.readGraph(req.params.filename);
      res.type('application/json').send(content);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.put('/:filename', async (req, res) => {
    try {
      const graphData = req.body;
      graphData.metadata = graphData.metadata || {};
      graphData.metadata.modified = new Date().toISOString();
      const compact = formatCompactJSON(JSON.stringify(graphData, null, 2), 2);
      await project.writeGraph(req.params.filename, compact);
      const { committed, sha } = await autoCommit(
        project.root,
        saveCommitMessage(req.params.filename),
        [req.params.filename]
      );
      res.json({ ok: true, committed, sha });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Version history for one graph — every commit that touched it, newest
  // first, plus whether the file on disk has changes no version holds yet.
  router.get('/:filename/versions', async (req, res) => {
    try {
      const filename = req.params.filename;
      if (!filename.endsWith('.cascade')) {
        res.status(400).json({ error: `not a .cascade file: ${filename}` });
        return;
      }
      // Resolve for the path-safety check; the git commands want the
      // repo-relative name, not the absolute one.
      project.resolve(filename);
      res.json({
        isGitRepo: project.isGitRepo,
        dirty: await isFileDirty(project.root, filename),
        versions: await listFileVersions(project.root, filename),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // One past version's contents. Restoring is a client-side act: it loads
  // this into the editor as unsaved work, so saving it forward becomes the
  // next version. Nothing here rewrites history.
  router.get('/:filename/versions/:sha', async (req, res) => {
    try {
      const filename = req.params.filename;
      if (!filename.endsWith('.cascade')) {
        res.status(400).json({ error: `not a .cascade file: ${filename}` });
        return;
      }
      project.resolve(filename);
      if (!/^[0-9a-fA-F]{4,40}$/.test(req.params.sha)) {
        res.status(400).json({ error: `not a commit hash: ${req.params.sha}` });
        return;
      }
      const content = await readFileAtVersion(project.root, filename, req.params.sha);
      res.type('application/json').send(content);
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}

/**
 * What a save says in Version History.
 *
 * Every save used to commit "Update <file>", so the history was a column of
 * identical rows and the only way to tell one version from another was its
 * position. The time makes each entry legible at a glance, which is what the
 * list is for; the date is already in the commit itself.
 */
export function saveCommitMessage(filename: string, at = new Date()): string {
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `Saved ${filename} ${time}`;
}
