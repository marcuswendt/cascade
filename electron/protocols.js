"use strict";
/**
 * Custom URL Protocols
 *
 * Registers custom URL schemes for Cascade:
 * - cascade-asset://: Serve local project assets
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupProtocols = setupProtocols;
exports.registerProtocolHandlers = registerProtocolHandlers;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
/**
 * Register protocol schemes (must be called before app is ready)
 */
function setupProtocols() {
    electron_1.protocol.registerSchemesAsPrivileged([
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
function registerProtocolHandlers() {
    // Serve local assets: cascade-asset://encoded-project-path/assets/image.png
    electron_1.protocol.handle('cascade-asset', (request) => {
        try {
            const url = new URL(request.url);
            // Hostname is the encoded project path
            const projectPath = decodeURIComponent(url.hostname);
            // Pathname is the asset path (remove leading /)
            const assetPath = decodeURIComponent(url.pathname.slice(1));
            // Build full path
            const fullPath = path_1.default.join(projectPath, assetPath);
            // Security: ensure path is within project folder
            const normalizedProjectPath = path_1.default.normalize(projectPath);
            const normalizedFullPath = path_1.default.normalize(fullPath);
            if (!normalizedFullPath.startsWith(normalizedProjectPath)) {
                console.error('[Protocol] Path traversal attempt blocked:', fullPath);
                return new Response('Forbidden', { status: 403 });
            }
            // Serve the file using net.fetch
            return electron_1.net.fetch(`file://${fullPath}`);
        }
        catch (err) {
            console.error('[Protocol] Error serving asset:', err);
            return new Response('Internal Server Error', { status: 500 });
        }
    });
    console.log('[Protocol] Registered cascade-asset:// protocol handler');
}
