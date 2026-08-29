/**
 * Asset routes — upload/serve/delete, scoped to the single ProjectRoot's
 * `assets/` folder (round 32 re-scope; ported from the old multi-project
 * routes/assets.ts, ../<id>/assets/* → assets/* directly under the
 * project root). Sorts uploads into images/audio/data subfolders by
 * mimetype, same as before.
 */
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import type { ProjectRoot } from '../project.js';
import { PathSafetyError, resolveWithinRoot } from '../pathSafety.js';

function handleError(res: import('express').Response, err: unknown) {
  if (err instanceof PathSafetyError) {
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: String(err) });
}

export function createAssetsRouter(project: ProjectRoot): Router {
  const router = Router();
  const assetsRoot = project.resolve('assets');

  const storage = multer.diskStorage({
    destination: async (_req, file, cb) => {
      let assetType = 'data';
      if (file.mimetype.startsWith('image/')) assetType = 'images';
      else if (file.mimetype.startsWith('audio/')) assetType = 'audio';
      const dir = path.join(assetsRoot, assetType);
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, file.originalname)
  });
  const upload = multer({ storage });

  router.post('/', upload.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'no file uploaded' });
      return;
    }
    const relativePath = path.relative(assetsRoot, req.file.path);
    res.json({
      id: req.file.filename,
      path: `./assets/${relativePath}`,
      type: req.file.mimetype.startsWith('image/') ? 'image' : req.file.mimetype.startsWith('audio/') ? 'audio' : 'binary',
      size: req.file.size,
      filename: req.file.filename
    });
  });

  router.get('/{*assetPath}', async (req, res) => {
    try {
      const rel = (req.params as any).assetPath?.join('/') ?? '';
      const full = resolveWithinRoot(assetsRoot, rel);
      res.sendFile(full);
    } catch (err) {
      if (err instanceof PathSafetyError) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(404).json({ error: 'asset not found' });
      }
    }
  });

  router.delete('/{*assetPath}', async (req, res) => {
    try {
      const rel = (req.params as any).assetPath?.join('/') ?? '';
      const full = resolveWithinRoot(assetsRoot, rel);
      await fs.unlink(full);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}
