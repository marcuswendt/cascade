import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
const PROJECTS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', 'cascade-projects');

// Ensure projects directory exists
async function ensureProjectsDir() {
  try {
    await fs.mkdir(PROJECTS_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create projects directory:', err);
  }
}

ensureProjectsDir();

// List all projects
router.get('/', async (req, res) => {
  try {
    const projects = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    const projectList = await Promise.all(
      projects
        .filter(dirent => dirent.isDirectory())
        .map(async (dirent) => {
          const projectPath = path.join(PROJECTS_DIR, dirent.name);
          const metadataPath = path.join(projectPath, 'metadata.json');
          
          try {
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
            return {
              id: dirent.name,
              name: metadata.name || dirent.name,
              created: metadata.created,
              modified: metadata.modified,
              description: metadata.description
            };
          } catch {
            return {
              id: dirent.name,
              name: dirent.name,
              created: new Date().toISOString(),
              modified: new Date().toISOString()
            };
          }
        })
    );
    
    res.json(projectList);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create new project
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    const projectId = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const projectPath = path.join(PROJECTS_DIR, projectId);
    
    // Check if project already exists
    try {
      await fs.access(projectPath);
      return res.status(409).json({ error: 'Project already exists' });
    } catch {
      // Project doesn't exist, create it
    }
    
    // Create project directory
    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(path.join(projectPath, 'assets', 'images'), { recursive: true });
    await fs.mkdir(path.join(projectPath, 'assets', 'audio'), { recursive: true });
    await fs.mkdir(path.join(projectPath, 'assets', 'data'), { recursive: true });
    
    // Create metadata
    const metadata = {
      name,
      description: description || '',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    
    await fs.writeFile(
      path.join(projectPath, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );
    
    // Create empty graph
    const emptyGraph = {
      version: '1.3.0',
      metadata,
      nodes: [],
      connections: [],
      annotations: [],
      packages: [],
      assets: { manifest: [] },
      execution: { entryPoints: [], cookingNodes: [], autoStart: false }
    };
    
    await fs.writeFile(
      path.join(projectPath, 'graph.cascade.json'),
      JSON.stringify(emptyGraph, null, 2)
    );
    
    res.status(201).json({
      id: projectId,
      ...metadata
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get project details
router.get('/:id', async (req, res) => {
  try {
    const projectPath = path.join(PROJECTS_DIR, req.params.id);
    const metadataPath = path.join(projectPath, 'metadata.json');
    
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    res.json({
      id: req.params.id,
      ...metadata
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Project not found' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Delete project
router.delete('/:id', async (req, res) => {
  try {
    const projectPath = path.join(PROJECTS_DIR, req.params.id);
    await fs.rm(projectPath, { recursive: true, force: true });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Rename project
router.patch('/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    const projectPath = path.join(PROJECTS_DIR, req.params.id);
    const metadataPath = path.join(projectPath, 'metadata.json');
    
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    if (name) metadata.name = name;
    if (description !== undefined) metadata.description = description;
    metadata.modified = new Date().toISOString();
    
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    res.json({ id: req.params.id, ...metadata });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get graph
router.get('/:id/graph', async (req, res) => {
  try {
    const projectPath = path.join(PROJECTS_DIR, req.params.id);
    const graphPath = path.join(projectPath, 'graph.cascade.json');
    
    const graphData = JSON.parse(await fs.readFile(graphPath, 'utf-8'));
    res.json(graphData);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Graph not found' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Save graph
router.put('/:id/graph', async (req, res) => {
  try {
    const projectPath = path.join(PROJECTS_DIR, req.params.id);
    const graphPath = path.join(projectPath, 'graph.cascade.json');
    const metadataPath = path.join(projectPath, 'metadata.json');
    
    // Update metadata modified time
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      metadata.modified = new Date().toISOString();
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch {
      // Metadata might not exist
    }
    
    // Save graph
    const graphData = req.body;
    graphData.metadata = graphData.metadata || {};
    graphData.metadata.modified = new Date().toISOString();
    
    await fs.writeFile(graphPath, JSON.stringify(graphData, null, 2));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { router as projectsRouter };

