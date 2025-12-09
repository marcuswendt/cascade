import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
const PROJECTS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', 'cascade-projects');

/**
 * Format JSON string with compact arrays (keeps small arrays on single lines)
 * This function finds multi-line arrays with 2-4 elements and compacts them
 * Handles both numeric arrays and arrays containing small arrays (like connections)
 */
function formatCompactJSON(jsonString: string, indent: number = 2): string {
  // Process multiple passes to handle nested arrays
  let result = jsonString;
  let previousResult = '';
  
  // Keep processing until no more changes (handles nested arrays)
  while (result !== previousResult) {
    previousResult = result;
    result = formatCompactJSONPass(result, indent);
  }
  
  return result;
}

/**
 * Single pass of compact formatting
 */
function formatCompactJSONPass(jsonString: string, indent: number = 2): string {
  const lines = jsonString.split('\n');
  const result: string[] = [];
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Check if this line starts an array (pattern: "key": [ or just [)
    if (trimmed.endsWith('[') && (trimmed.includes(':') || trimmed === '[')) {
      // Collect lines until we find the closing bracket
      let arrayLines: string[] = [line];
      let bracketDepth = 1;
      let j = i + 1;
      
      while (j < lines.length && bracketDepth > 0) {
        const currentLine = lines[j];
        arrayLines.push(currentLine);
        
        // Count bracket depth
        for (const char of currentLine) {
          if (char === '[') bracketDepth++;
          if (char === ']') bracketDepth--;
        }
        j++;
      }
      
      // Extract array content (lines between opening and closing brackets)
      // Handle nested arrays by extracting complete array elements
      const arrayContent: string[] = [];
      let k = 1;
      while (k < arrayLines.length - 1) {
        const currentLine = arrayLines[k].trim();
        
        // Check if this line starts a nested array
        if (currentLine.endsWith('[') || (currentLine.startsWith('[') && !currentLine.endsWith(']'))) {
          // Extract the complete nested array
          let nestedArrayLines: string[] = [arrayLines[k]];
          let nestedDepth = 1;
          let m = k + 1;
          
          while (m < arrayLines.length - 1 && nestedDepth > 0) {
            nestedArrayLines.push(arrayLines[m]);
            for (const char of arrayLines[m]) {
              if (char === '[') nestedDepth++;
              if (char === ']') nestedDepth--;
            }
            m++;
          }
          
          // Join nested array lines into a single compact representation
          const nestedContent: string[] = [];
          for (let n = 1; n < nestedArrayLines.length - 1; n++) {
            const nestedLine = nestedArrayLines[n].trim().replace(/,$/, '').trim();
            if (nestedLine) {
              nestedContent.push(nestedLine);
            }
          }
          
          // Create compact nested array string
          const nestedArray = '[' + nestedContent.map(c => c.trim()).join(', ') + ']';
          arrayContent.push(nestedArray);
          k = m;
        } else {
          // Simple element
          const content = currentLine.replace(/,$/, '').trim();
          if (content) {
            arrayContent.push(content);
          }
          k++;
        }
      }
      
      // Check if it's a small numeric array (2-4 elements)
      const isSmallNumericArray = arrayContent.length >= 2 && 
                                  arrayContent.length <= 4 &&
                                  arrayContent.every(item => {
                                    const trimmed = item.trim();
                                    return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed);
                                  });
      
      // Check if it's an array containing small arrays (like connections: [[a, b], [c, d]])
      // Look for patterns where each element is a small array (2-4 elements)
      // This handles both already-compacted arrays and multi-line nested arrays
      let isArrayOfSmallArrays = false;
      if (arrayContent.length >= 2 && arrayContent.length <= 20) { // Reasonable limit for connections
        // Check if elements are arrays (either compact or multi-line)
        const allAreArrays = arrayContent.every(item => {
          const trimmed = item.trim();
          // Already compact array like [a, b] or ["a", 0]
          if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            const inner = trimmed.slice(1, -1).trim();
            const parts = inner.split(',').map(p => p.trim()).filter(p => p);
            return parts.length >= 2 && parts.length <= 4;
          }
          // Multi-line array - check if this line starts an array
          if (trimmed.endsWith('[')) {
            return true; // This will be handled in a later pass
          }
          return false;
        });
        
        if (allAreArrays) {
          // Check if inner arrays are small (2-4 elements each)
          // For multi-line arrays, we'll need to extract their content
          let allSmall = true;
          for (const item of arrayContent) {
            const trimmed = item.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
              // Already compact - check size
              const inner = trimmed.slice(1, -1).trim();
              const parts = inner.split(',').map(p => p.trim()).filter(p => p);
              if (parts.length < 2 || parts.length > 4) {
                allSmall = false;
                break;
              }
            } else if (trimmed.endsWith('[')) {
              // Multi-line array - will be compacted in next pass, assume it's small for now
              // We'll handle this in the multi-pass approach
            } else {
              allSmall = false;
              break;
            }
          }
          isArrayOfSmallArrays = allSmall;
        }
      }
      
      if (isSmallNumericArray || isArrayOfSmallArrays) {
        // Compact format: put entire array on one line
        const indentLevel = (line.match(/^(\s*)/)?.[1] || '').length;
        // Extract the key part (everything before the opening bracket)
        const keyMatch = trimmed.match(/^(.+?)\s*\[\s*$/);
        const keyPart = keyMatch ? keyMatch[1] : '';
        
        // Check if the closing bracket line has a comma (last line in arrayLines)
        const closingLine = arrayLines[arrayLines.length - 1];
        const hasComma = closingLine.trim().endsWith(',');
        
        // Format array content
        let formattedContent: string;
        if (isArrayOfSmallArrays) {
          // For arrays of arrays, each element should be compact
          // If an element is a multi-line array (ends with [), we can't compact it yet
          // Otherwise, use the already-compact form
          formattedContent = arrayContent.map(c => {
            const trimmed = c.trim();
            // If it's already compact, use it as-is
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
              return trimmed;
            }
            // If it's a multi-line array start, we'll need another pass
            // For now, return as-is (will be handled in next pass)
            return trimmed;
          }).join(', ');
        } else {
          // Simple numeric array
          formattedContent = arrayContent.map(c => c.trim()).join(', ');
        }
        
        const compactArray = keyPart + ' [' + formattedContent + ']' + (hasComma ? ',' : '');
        result.push(' '.repeat(indentLevel) + compactArray);
        i = j; // Skip the processed lines
        continue;
      }
    }
    
    result.push(line);
    i++;
  }
  
  return result.join('\n');
}

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
      version: '0.1',
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
    
    // Apply compact formatting to keep small arrays on single lines
    const jsonString = JSON.stringify(graphData, null, 2);
    const compactJsonString = formatCompactJSON(jsonString, 2);
    await fs.writeFile(graphPath, compactJsonString);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { router as projectsRouter };

