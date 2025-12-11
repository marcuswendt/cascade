import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';

const router = Router();

const PROJECTS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', 'cascade-projects');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const projectId = req.params.id;
    const projectPath = path.join(PROJECTS_DIR, projectId);
    
    // Determine asset type from mimetype
    let assetType = 'data';
    if (file.mimetype.startsWith('image/')) {
      assetType = 'images';
    } else if (file.mimetype.startsWith('audio/')) {
      assetType = 'audio';
    }
    
    const assetDir = path.join(projectPath, 'assets', assetType);
    await fs.mkdir(assetDir, { recursive: true });
    cb(null, assetDir);
  },
  filename: (req, file, cb) => {
    // Preserve original filename
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

// Upload asset
router.post('/:id/assets', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const projectId = req.params.id;
    const relativePath = `./assets/${req.file.path.split('assets/')[1]}`;
    
    res.json({
      id: req.file.filename,
      path: relativePath,
      type: req.file.mimetype.startsWith('image/') ? 'image' : 
            req.file.mimetype.startsWith('audio/') ? 'audio' : 'binary',
      size: req.file.size,
      filename: req.file.filename
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Serve asset
router.get('/:id/assets/*', async (req, res) => {
  try {
    const projectId = req.params.id;
    const assetPath = (req.params as any)[0];
    const fullPath = path.join(PROJECTS_DIR, projectId, 'assets', assetPath);
    
    res.sendFile(fullPath);
  } catch (error: any) {
    res.status(404).json({ error: 'Asset not found' });
  }
});

// Delete asset
router.delete('/:id/assets/*', async (req, res) => {
  try {
    const projectId = req.params.id;
    const assetPath = (req.params as any)[0];
    const fullPath = path.join(PROJECTS_DIR, projectId, 'assets', assetPath);
    
    await fs.unlink(fullPath);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { router as assetsRouter };

