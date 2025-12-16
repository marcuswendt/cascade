import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const monacoEditorPlugin = require('vite-plugin-monaco-editor').default;

export default defineConfig({
  plugins: [
    svelte(),
    monacoEditorPlugin({})
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  optimizeDeps: {
    exclude: ['svelte']
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco-editor': ['monaco-editor'],
          'ai-anthropic': ['@anthropic-ai/sdk'],
          'ai-google': ['@google/genai'],
          'ai-openai': ['openai'],
          'dockview': ['dockview-core'],
          'icons': ['lucide-svelte']
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
});

