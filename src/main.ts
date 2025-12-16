import { mount } from 'svelte';
import App from './App.svelte';
import { initializeProviders } from './services/genai/providers';
import { initializeNodeLibraries } from './nodes/initializeLibraries';

// Initialize application
async function init() {
  // Initialize AI providers (sync)
  initializeProviders();

  // Initialize node libraries (async - enables code splitting)
  await initializeNodeLibraries();

  // Mount app after libraries are ready
  mount(App, {
    target: document.getElementById('app')!
  });
}

init();

