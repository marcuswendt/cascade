import { mount } from 'svelte';
import App from './App.svelte';
import './editor/theme.css';
import { startThemeController } from './editor/themeController';
import { initializeNodeLibraries } from './nodes/initializeLibraries';

// Initialize application
async function init() {
  // Resolve the theme before the first paint so a dark Studio never flashes light
  startThemeController();

  // Initialize node libraries (async - enables code splitting)
  await initializeNodeLibraries();

  // Mount app after libraries are ready
  mount(App, {
    target: document.getElementById('app')!
  });
}

init();
