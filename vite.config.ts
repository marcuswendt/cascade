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
    modulePreload: {
      // Round 32: "load Monaco only on demand... mostly they don't" —
      // CodeEditor.svelte is only reachable now via a dynamic import()
      // (DockviewContainer's registerLazyPanelComponent), but Vite's
      // default modulePreload behavior still auto-injects a
      // <link rel="modulepreload"> for every chunk reachable ANYWHERE in
      // the graph, dynamic imports included — confirmed in dist/index.html
      // after the component-level fix: monaco-editor's own chunk was
      // still preloaded (fetched at page load) even though CodeEditor's
      // no longer was. This filters the monaco/language-mode chunks out
      // of that auto-preload list specifically, rather than disabling
      // modulePreload globally (which would also stop legitimate eager
      // chunks — dockview, icons, etc. — from being preloaded).
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => !/monaco-editor|CodeEditor|Mode-[\w-]+\.js$/.test(dep))
    },
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

