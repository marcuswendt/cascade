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
    const args = ['--print', '--output-format', 'text'];

    // Add system prompt if provided
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Prompt will be piped via stdin to handle long/complex prompts
    args.push('-'); // Read from stdin

    console.log('[claude-cli] Starting generation...');

    const claude = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let output = '';
    let errorOutput = '';

    claude.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log('[claude-cli] stdout chunk:', chunk.slice(0, 100) + (chunk.length > 100 ? '...' : ''));
    });

    claude.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      console.log('[claude-cli] stderr:', chunk);
    });

    claude.on('close', (code) => {
      console.log('[claude-cli] Process closed with code:', code);
      if (code !== 0) {
        return res.status(500).json({
          error: errorOutput || `Claude CLI exited with code ${code}`
        });
      }
      res.json({ code: output.trim() });
    });

    claude.on('error', (err) => {
      console.log('[claude-cli] Process error:', err.message);
      res.status(500).json({ error: err.message });
    });

    // Write prompt to stdin and close it
    claude.stdin.write(prompt);
    claude.stdin.end();

  } catch (error: any) {
    console.log('[claude-cli] Exception:', error.message);
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
    const args = ['--print', '--output-format', 'text'];

    // Add system prompt if provided
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Prompt will be piped via stdin
    args.push('-');

    console.log('[claude-cli] Starting stream generation...');

    const claude = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let fullOutput = '';

    claude.stdout.on('data', (data) => {
      const chunk = data.toString();
      fullOutput += chunk;
      console.log('[claude-cli] stream stdout chunk:', chunk.slice(0, 50) + (chunk.length > 50 ? '...' : ''));
      // Send each chunk as an SSE event
      res.write(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`);
    });

    claude.stderr.on('data', (data) => {
      const error = data.toString();
      console.log('[claude-cli] stream stderr:', error);
      // Don't send stderr as error - it might be progress/info
    });

    claude.on('close', (code) => {
      console.log('[claude-cli] stream process closed with code:', code);
      if (code === 0) {
        res.write(`data: ${JSON.stringify({ type: 'complete', code: fullOutput.trim() })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', content: `Process exited with code ${code}` })}\n\n`);
      }
      res.end();
    });

    claude.on('error', (err) => {
      console.log('[claude-cli] stream process error:', err.message);
      res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
      res.end();
    });

    // Write prompt to stdin and close it
    claude.stdin.write(prompt);
    claude.stdin.end();

    // Handle client disconnect
    req.on('close', () => {
      console.log('[claude-cli] Client disconnected, killing process');
      claude.kill();
    });

  } catch (error: any) {
    console.log('[claude-cli] stream exception:', error.message);
    res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
    res.end();
  }
});

export { router as aiRouter };
