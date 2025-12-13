<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { exportSingleHTML, exportFolder, downloadFile } from '@/utils/export';
  import type { Graph } from '@/nodes/Graph';

  export let graph: Graph;
  export let open = false;

  const dispatch = createEventDispatcher();
  
  let projectName = 'Cascade Project';
  let isExporting = false;
  let exportError: string | null = null;
  let exportFormat: 'html' | 'folder' = 'html';

  async function handleExport() {
    if (!graph || isExporting) return;

    isExporting = true;
    exportError = null;

    try {
      if (exportFormat === 'html') {
        const html = await exportSingleHTML(graph, projectName);
        const filename = `${projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;
        downloadFile(html, filename, 'text/html');
      } else {
        await exportFolder(graph, projectName);
      }
      
      // Close dialog after successful export
      setTimeout(() => {
        open = false;
        dispatch('close');
      }, 500);
    } catch (error: any) {
      exportError = error.message || 'Failed to export project';
      console.error('Export error:', error);
    } finally {
      isExporting = false;
    }
  }

  function handleClose() {
    open = false;
    dispatch('close');
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if open}
  <div class="overlay" on:click={handleClose} on:click|self={handleClose}>
    <div class="dialog" on:click|stopPropagation>
      <div class="header">
        <h2>Export Project</h2>
        <button class="close-button" on:click={handleClose}>×</button>
      </div>

      <div class="content">
        <div class="form-group">
          <label for="project-name">Project Name</label>
          <input
            id="project-name"
            type="text"
            bind:value={projectName}
            placeholder="My Project"
            disabled={isExporting}
          />
        </div>

        <div class="form-group">
          <label for="export-format">Export Format</label>
          <select
            id="export-format"
            bind:value={exportFormat}
            disabled={isExporting}
          >
            <option value="html">Single HTML File (all assets embedded)</option>
            <option value="folder">Folder Structure (separate files)</option>
          </select>
        </div>

        <div class="info">
          {#if exportFormat === 'html'}
            <p>This will export your project as a standalone HTML file with all assets embedded.</p>
            <ul>
              <li>✅ All nodes and connections</li>
              <li>✅ All node code</li>
              <li>✅ All assets (embedded as base64)</li>
              <li>✅ Minimal runtime (~50KB)</li>
              <li>✅ Single file - easy to share</li>
            </ul>
          {:else}
            <p>This will export your project as a folder structure with separate files.</p>
            <ul>
              <li>✅ index.html - Main HTML file</li>
              <li>✅ runtime.js - Cascade runtime</li>
              <li>✅ graph.js - Compiled graph</li>
              <li>✅ assets.json - Asset manifest</li>
              <li>✅ assets/ - Asset files folder</li>
              <li>⚠️ You'll need to manually organize asset files</li>
            </ul>
          {/if}
        </div>

        {#if exportError}
          <div class="error">
            {exportError}
          </div>
        {/if}
      </div>

      <div class="footer">
        <button class="cancel-button" on:click={handleClose} disabled={isExporting}>
          Cancel
        </button>
        <button class="export-button" on:click={handleExport} disabled={isExporting}>
          {#if isExporting}
            Exporting...
          {:else}
            Export {exportFormat === 'html' ? 'HTML' : 'Folder'}
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .dialog {
    background: #1e1e1e;
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    width: 90%;
    max-width: 500px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.2s ease-out;
  }

  @keyframes slideUp {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .header h2 {
    margin: 0;
    color: #fff;
    font-size: 20px;
    font-weight: 600;
  }

  .close-button {
    background: transparent;
    border: none;
    color: #aaa;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .close-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .content {
    padding: 20px;
    flex: 1;
    overflow-y: auto;
  }

  .form-group {
    margin-bottom: 20px;
  }

  .form-group label {
    display: block;
    color: #aaa;
    font-size: 12px;
    font-weight: 500;
    margin-bottom: 8px;
  }

  .form-group input {
    width: 100%;
    padding: 10px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    box-sizing: border-box;
  }

  .form-group input:focus {
    outline: none;
    border-color: #4a9eff;
  }

  .form-group input:disabled,
  .form-group select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .form-group select {
    width: 100%;
    padding: 10px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    box-sizing: border-box;
    cursor: pointer;
  }
  
  .form-group select:focus {
    outline: none;
    border-color: #4a9eff;
  }

  .info {
    background: rgba(74, 158, 255, 0.1);
    border: 1px solid rgba(74, 158, 255, 0.2);
    border-radius: 4px;
    padding: 16px;
    margin-top: 20px;
  }

  .info p {
    color: #fff;
    font-size: 14px;
    margin: 0 0 12px 0;
  }

  .info ul {
    margin: 0;
    padding-left: 20px;
    color: #aaa;
    font-size: 13px;
  }

  .info li {
    margin: 4px 0;
  }

  .error {
    background: rgba(255, 68, 68, 0.1);
    border: 1px solid rgba(255, 68, 68, 0.3);
    border-radius: 4px;
    padding: 12px;
    color: #ff6b6b;
    font-size: 13px;
    margin-top: 16px;
  }

  .footer {
    display: flex;
    gap: 12px;
    padding: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    justify-content: flex-end;
  }

  .cancel-button,
  .export-button {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cancel-button {
    background: transparent;
    color: #aaa;
  }

  .cancel-button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .export-button {
    background: #4a9eff;
    color: white;
  }

  .export-button:hover:not(:disabled) {
    background: #357abd;
  }

  .export-button:disabled,
  .cancel-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>



