/**
 * Server Lifecycle Management
 *
 * Manages the embedded Express server as a child process.
 * The server runs in a forked process to avoid blocking the main process.
 */

import { fork, ChildProcess, ForkOptions } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serverProcess: ChildProcess | null = null;

const SERVER_PORT = 3030;
const WS_PORT = 3031;
const SERVER_TIMEOUT = 15000; // 15 seconds to start

/**
 * Start the embedded Express server
 */
export async function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    // In packaged app, server is in resources/server/dist
    // In development, it's in ../server/dist relative to electron folder
    const serverPath = app.isPackaged
      ? path.join(process.resourcesPath, 'server/dist/index.js')
      : path.join(__dirname, '../server/dist/index.js');

    console.log(`[Electron] Starting server from: ${serverPath}`);

    // Fork options
    const forkOptions: ForkOptions = {
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        WS_PORT: String(WS_PORT),
        // Use app-specific data directory
        CASCADE_PROJECTS_DIR: getCascadeProjectsDir(),
        // Indicate we're running in Electron
        ELECTRON: 'true',
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    };

    // Fork the server as a child process
    serverProcess = fork(serverPath, [], forkOptions);

    serverProcess.stdout?.on('data', (data) => {
      console.log(`[Server] ${data.toString().trim()}`);
    });

    serverProcess.stderr?.on('data', (data) => {
      console.error(`[Server Error] ${data.toString().trim()}`);
    });

    serverProcess.on('error', (err) => {
      console.error('[Electron] Failed to start server:', err);
      reject(err);
    });

    serverProcess.on('exit', (code, signal) => {
      console.log(`[Electron] Server process exited with code ${code}, signal ${signal}`);
      serverProcess = null;
    });

    // Wait for server to be ready by polling the health endpoint
    waitForServer()
      .then(() => {
        console.log('[Electron] Server is ready');
        resolve();
      })
      .catch((err) => {
        console.error('[Electron] Server failed to start:', err);
        stopServer();
        reject(err);
      });
  });
}

/**
 * Stop the embedded Express server
 */
export async function stopServer(): Promise<void> {
  if (serverProcess) {
    console.log('[Electron] Stopping server...');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        console.log('[Electron] Force killing server...');
        serverProcess?.kill('SIGKILL');
        serverProcess = null;
        resolve();
      }, 5000);

      serverProcess!.once('exit', () => {
        clearTimeout(timeout);
        serverProcess = null;
        console.log('[Electron] Server stopped');
        resolve();
      });

      // Try graceful shutdown first
      serverProcess!.kill('SIGTERM');
    });
  }
}

/**
 * Check if the server is running
 */
export function isServerRunning(): boolean {
  return serverProcess !== null && !serverProcess.killed;
}

/**
 * Get the server URL
 */
export function getServerUrl(): string {
  return `http://localhost:${SERVER_PORT}`;
}

/**
 * Get the WebSocket URL
 */
export function getWebSocketUrl(): string {
  return `ws://localhost:${WS_PORT}`;
}

/**
 * Wait for server to be ready by polling the health endpoint
 */
async function waitForServer(): Promise<void> {
  const startTime = Date.now();
  const healthUrl = `http://localhost:${SERVER_PORT}/health`;

  while (Date.now() - startTime < SERVER_TIMEOUT) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet, continue polling
    }

    // Wait 100ms before next poll
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`Server failed to start within ${SERVER_TIMEOUT}ms`);
}

/**
 * Get the Cascade projects directory
 */
function getCascadeProjectsDir(): string {
  // Use standard location: ~/cascade-projects
  // This matches the browser mode behavior
  return path.join(app.getPath('home'), 'cascade-projects');
}

/**
 * Restart the server (useful for development)
 */
export async function restartServer(): Promise<void> {
  console.log('[Electron] Restarting server...');
  await stopServer();
  await startServer();
}
