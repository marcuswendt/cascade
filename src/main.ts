import { mount } from 'svelte';
import App from './App.svelte';
import { initializeNodeLibraries } from './nodes/initializeLibraries';

// Initialize application
async function init() {
  // Initialize node libraries (async - enables code splitting)
  await initializeNodeLibraries();

  // Mount app after libraries are ready
  mount(App, {
    target: document.getElementById('app')!
  });
}

init();
