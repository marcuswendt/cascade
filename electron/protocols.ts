/**
 * Custom URL Protocols
 *
 * Registers custom URL schemes for Cascade:
 * - cascade-asset://: Serve local project assets
 */

import { protocol, net } from 'electron';
import path from 'path';

/**
 * Register protocol schemes (must be called before app is ready)
 */
export function setupProtocols(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'cascade-asset',
      privileges: {
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ]);
}

/**
 * Register protocol handlers (must be called after app is ready)
 */
export function registerProtocolHandlers(): void {
  // Serve local assets: cascade-asset://encoded-project-path/assets/image.png
  protocol.handle('cascade-asset', (request) => {
    try {
      const url = new URL(request.url);

      // Hostname is the encoded project path
      const projectPath = decodeURIComponent(url.hostname);

      // Pathname is the asset path (remove leading /)
      const assetPath = decodeURIComponent(url.pathname.slice(1));

      // Build full path
      const fullPath = path.join(projectPath, assetPath);

      // Security: ensure path is within project folder
      const normalizedProjectPath = path.normalize(projectPath);
      const normalizedFullPath = path.normalize(fullPath);

      if (!normalizedFullPath.startsWith(normalizedProjectPath)) {
        console.error('[Protocol] Path traversal attempt blocked:', fullPath);
        return new Response('Forbidden', { status: 403 });
      }

      // Serve the file using net.fetch
      return net.fetch(`file://${fullPath}`);
    } catch (err) {
      console.error('[Protocol] Error serving asset:', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  });

  console.log('[Protocol] Registered cascade-asset:// protocol handler');
}
