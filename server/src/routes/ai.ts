/**
 * AI Routes - Claude CLI integration for code generation
 */

import { Router } from 'express';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

// Check if claude CLI is available
let claudeCliAvailable: boolean | null = null;

async function checkClaudeCliAvailable(): Promise<boolean> {
  if (claudeCliAvailable !== null) {
    return claudeCliAvailable;
  }

  try {
    await execAsync('which claude');
    claudeCliAvailable = true;
  } catch {
    try {
      // Try Windows-style check
      await execAsync('where claude');
      claudeCliAvailable = true;
    } catch {
      claudeCliAvailable = false;
    }
  }

  return claudeCliAvailable;
}

// Check if claude CLI is available
router.get('/claude-cli/status', async (req, res) => {
  try {
    const available = await checkClaudeCliAvailable();
    res.json({ available });
  } catch (error: any) {
    res.json({ available: false, error: error.message });
  }
});

// Generate code using claude CLI
router.post('/claude-cli/generate', async (req, res) => {
  const { prompt, systemPrompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const available = await checkClaudeCliAvailable();
  if (!available) {
    return res.status(503).json({
      error: 'Claude CLI is not installed. Install it with: npm install -g @anthropic-ai/claude-code'
    });
  }

  try {
    // Build the claude command with print flag for non-interactive output
    // Use --print to get output without interactive mode
    const args = ['--print'];

    // Add system prompt if provided
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Add the user prompt
    args.push(prompt);

    const claude = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let output = '';
    let errorOutput = '';

    claude.stdout.on('data', (data) => {
      output += data.toString();
    });

    claude.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    claude.on('close', (code) => {
      if (code !== 0) {
        return res.status(500).json({
          error: errorOutput || `Claude CLI exited with code ${code}`
        });
      }
      res.json({ code: output.trim() });
    });

    claude.on('error', (err) => {
      res.status(500).json({ error: err.message });
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Stream generation using claude CLI
router.post('/claude-cli/stream', async (req, res) => {
  const { prompt, systemPrompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const available = await checkClaudeCliAvailable();
  if (!available) {
    return res.status(503).json({
      error: 'Claude CLI is not installed. Install it with: npm install -g @anthropic-ai/claude-code'
    });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // Build the claude command with print flag
    const args = ['--print'];

    // Add system prompt if provided
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Add the user prompt
    args.push(prompt);

    const claude = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let fullOutput = '';

    claude.stdout.on('data', (data) => {
      const chunk = data.toString();
      fullOutput += chunk;
      // Send each chunk as an SSE event
      res.write(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`);
    });

    claude.stderr.on('data', (data) => {
      const error = data.toString();
      res.write(`data: ${JSON.stringify({ type: 'error', content: error })}\n\n`);
    });

    claude.on('close', (code) => {
      if (code === 0) {
        res.write(`data: ${JSON.stringify({ type: 'complete', code: fullOutput.trim() })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', content: `Process exited with code ${code}` })}\n\n`);
      }
      res.end();
    });

    claude.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
      res.end();
    });

    // Handle client disconnect
    req.on('close', () => {
      claude.kill();
    });

  } catch (error: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
    res.end();
  }
});

export { router as aiRouter };
