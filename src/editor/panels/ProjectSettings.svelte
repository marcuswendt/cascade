<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Graph } from '@/nodes/Graph';
  import type { ProjectPackage } from '@/types/node.types';
  import Icon from '../Icon.svelte';
  import { X, Plus, Trash2, FolderOpen, Package, AlertCircle } from '@lucide/svelte';
  import { loadProjectSettings, saveProjectSettings, type ProjectSettingsDto } from '../projectSettingsApi';

  export let open = false;
  export let graph: Graph | undefined = undefined;

  const dispatch = createEventDispatcher<{
    close: void;
    save: { packages: ProjectPackage[]; graphName: string; projectName: string; missingCredentials: string[] };
  }>();

  // Local state for editing
  let packages: ProjectPackage[] = [];
  let newPackagePath = '';
  let newPackageAlias = '';
  let showAddForm = false;
  let error = '';
  let graphName = '';
  let graphDescription = '';
  let graphAuthor = '';
  let projectName = '';
  let commandsJson = '{}';
  let settingsJson = '{}';
  let credentialNames = '';
  let credentialStatus: ProjectSettingsDto['requiredCredentials'] = [];
  let loadedForOpen = false;
  let projectAvailable = false;

  // Sync with graph when opening
  $: if (open && graph) {
    packages = [...graph.project.packages];
    showAddForm = false;
    error = '';
    newPackagePath = '';
    newPackageAlias = '';
  }

  $: if (!open) loadedForOpen = false;
  $: if (open && graph && !loadedForOpen) {
    loadedForOpen = true;
    graphName = graph.project.name ?? '';
    graphDescription = graph.project.description ?? '';
    graphAuthor = graph.project.author ?? '';
    loadProjectSettings().then((state) => {
      projectAvailable = true;
      projectName = state.manifest.name;
      commandsJson = JSON.stringify(state.manifest.commands, null, 2);
      settingsJson = JSON.stringify(state.manifest.settings, null, 2);
      credentialNames = state.manifest.credentials.join('\n');
      credentialStatus = state.requiredCredentials;
    }).catch(() => { projectAvailable = false; });
  }

  function handleClose() {
    open = false;
    dispatch('close');
  }

  async function handleSave() {
    error = '';
    let commands: Record<string, string>;
    let settings: Record<string, unknown>;
    try {
      commands = JSON.parse(commandsJson || '{}');
      settings = JSON.parse(settingsJson || '{}');
      if (projectAvailable) {
        const state = await saveProjectSettings({
          name: projectName.trim(), commands, settings,
          credentials: credentialNames.split(/\r?\n|,/).map((name) => name.trim()).filter(Boolean),
        });
        credentialStatus = state.requiredCredentials;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      return;
    }
    if (graph) {
      graph.project.name = graphName.trim();
      graph.project.description = graphDescription.trim();
      graph.project.author = graphAuthor.trim();
      graph.project.packages = [...packages];
      // Update module resolver
      packages.forEach(pkg => {
        graph.moduleResolver.addProjectPackage(pkg);
      });
    }
    dispatch('save', {
      packages: [...packages], graphName: graphName.trim(), projectName: projectName.trim(),
      missingCredentials: credentialStatus.filter((item) => !item.set).map((item) => item.name),
    });
    handleClose();
  }

  function handleAddPackage() {
    error = '';

    if (!newPackagePath.trim()) {
      error = 'Path is required';
      return;
    }

    if (!newPackageAlias.trim()) {
      error = 'Alias is required';
      return;
    }

    // Validate alias format (alphanumeric, no dots at start)
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(newPackageAlias)) {
      error = 'Alias must start with a letter and contain only letters, numbers, and underscores';
      return;
    }

    // Check for duplicate alias
    if (packages.some(p => p.alias === newPackageAlias)) {
      error = `Alias "${newPackageAlias}" already exists`;
      return;
    }

    packages = [...packages, {
      path: newPackagePath.trim(),
      alias: newPackageAlias.trim()
    }];

    newPackagePath = '';
    newPackageAlias = '';
    showAddForm = false;
  }

  function handleRemovePackage(index: number) {
    packages = packages.filter((_, i) => i !== index);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (showAddForm) {
        showAddForm = false;
      } else {
        handleClose();
      }
    }
  }

  // Auto-generate alias from path
  function suggestAlias(path: string): string {
    // Extract folder name from path
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    const lastPart = parts[parts.length - 1] || 'mypackage';
    // Clean up: remove special chars, lowercase
    return lastPart.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'mypackage';
  }

  $: if (newPackagePath && !newPackageAlias) {
    newPackageAlias = suggestAlias(newPackagePath);
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div class="modal-overlay" on:click={handleClose} on:keydown={handleKeydown} role="button" tabindex="-1">
    <div class="modal" on:click|stopPropagation role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-header">
        <h2 id="modal-title">
          <Package size={20} />
          Project Settings
        </h2>
        <button class="close-button" on:click={handleClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>

      <div class="modal-body">
        <section class="section">
          <h3>Graph Metadata <small>(current .cascade file)</small></h3>
          <div class="form-row"><label for="graph-name">Name</label><input id="graph-name" bind:value={graphName} /></div>
          <div class="form-row"><label for="graph-description">Description</label><input id="graph-description" bind:value={graphDescription} /></div>
          <div class="form-row"><label for="graph-author">Author</label><input id="graph-author" bind:value={graphAuthor} /></div>
          <div class="form-row"><label>Created</label><input value={graph?.created ?? ''} readonly /></div>
        </section>

        <section class="section">
          <h3>Project Manifest <small>(cascade.json, shared by every graph)</small></h3>
          <div class="form-row"><label for="project-name">Project name</label><input id="project-name" bind:value={projectName} /></div>
          <div class="form-row"><label for="commands-json">Allowed commands</label><textarea id="commands-json" rows="4" bind:value={commandsJson}></textarea></div>
          <div class="form-row"><label for="settings-json">Node settings</label><textarea id="settings-json" rows="5" bind:value={settingsJson}></textarea></div>
          <div class="form-row"><label for="credentials-list">Required credentials</label><textarea id="credentials-list" rows="3" bind:value={credentialNames} placeholder="one credential name per line"></textarea></div>
          {#if credentialStatus.length}
            <div class="credentials-status">
              {#each credentialStatus as credential}
                <span class:set={credential.set}>{credential.name}: {credential.set ? 'set' : 'not set'}</span>
              {/each}
              <small>Add missing values to <code>~/.cascade/credentials.yaml</code> or the file named by <code>CASCADE_CREDENTIALS</code>. Values are never shown here.</small>
            </div>
          {/if}
        </section>

        <section class="section">
          <h3>Project Packages</h3>
          <p class="section-description">
            Add local folders as packages. Each package gets an alias that you can use to import modules.
            <br />
            Example: <code>myproject.filters.Blur</code> for file <code>./src/filters/Blur.ts</code>
          </p>

          {#if packages.length === 0 && !showAddForm}
            <div class="empty-state">
              <FolderOpen size={32} />
              <p>No project packages configured</p>
              <button class="add-button" on:click={() => showAddForm = true}>
                <Plus size={16} />
                Add Package
              </button>
            </div>
          {:else}
            <div class="packages-list">
              {#each packages as pkg, index}
                <div class="package-item">
                  <div class="package-info">
                    <span class="package-alias">{pkg.alias}</span>
                    <span class="package-path">{pkg.path}</span>
                  </div>
                  <button
                    class="remove-button"
                    on:click={() => handleRemovePackage(index)}
                    aria-label="Remove package"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              {/each}
            </div>

            {#if !showAddForm}
              <button class="add-button secondary" on:click={() => showAddForm = true}>
                <Plus size={16} />
                Add Package
              </button>
            {/if}
          {/if}

          {#if showAddForm}
            <div class="add-form">
              <div class="form-row">
                <label for="package-path">Path</label>
                <div class="input-with-button">
                  <input
                    id="package-path"
                    type="text"
                    bind:value={newPackagePath}
                    placeholder="./src or ../shared-lib"
                  />
                  <button class="browse-button" title="Browse folder">
                    <FolderOpen size={16} />
                  </button>
                </div>
              </div>
              <div class="form-row">
                <label for="package-alias">Alias</label>
                <input
                  id="package-alias"
                  type="text"
                  bind:value={newPackageAlias}
                  placeholder="myproject"
                />
              </div>
              {#if error}
                <div class="error-message">
                  <AlertCircle size={14} />
                  {error}
                </div>
              {/if}
              <div class="form-actions">
                <button class="cancel-button" on:click={() => showAddForm = false}>
                  Cancel
                </button>
                <button class="confirm-button" on:click={handleAddPackage}>
                  Add Package
                </button>
              </div>
            </div>
          {/if}
        </section>

        <section class="section">
          <h3>Project Info</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Embedded Modules</span>
              <span class="info-value">
                {graph ? Object.keys(graph.moduleResolver.exportConfig().embeddedModules).length : 0}
              </span>
            </div>
            <div class="info-item">
              <span class="info-label">External Modules</span>
              <span class="info-value">
                {graph ? Object.keys(graph.moduleResolver.exportConfig().externalModules).length : 0}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div class="modal-footer">
        <button class="cancel-button" on:click={handleClose}>
          Cancel
        </button>
        <button class="save-button" on:click={handleSave}>
          Save Changes
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: #1e1e1e;
    border-radius: 8px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    width: 560px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #333;
  }

  .modal-header h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #fff;
  }

  .close-button {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .section {
    margin-bottom: 24px;
  }

  .section:last-child {
    margin-bottom: 0;
  }

  .section h3 {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    margin: 0 0 8px 0;
  }

  .section-description {
    font-size: 13px;
    color: #888;
    margin: 0 0 16px 0;
    line-height: 1.5;
  }

  .section-description code {
    background: rgba(255, 255, 255, 0.1);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
    color: #4a9eff;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 32px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed #444;
    border-radius: 8px;
    color: #666;
  }

  .empty-state p {
    margin: 0;
    font-size: 14px;
  }

  .packages-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }

  .package-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid #333;
    border-radius: 6px;
  }

  .package-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .package-alias {
    font-size: 14px;
    font-weight: 500;
    color: #4a9eff;
    font-family: 'SF Mono', Monaco, monospace;
  }

  .package-path {
    font-size: 12px;
    color: #888;
    font-family: 'SF Mono', Monaco, monospace;
  }

  .remove-button {
    background: transparent;
    border: none;
    color: #666;
    cursor: pointer;
    padding: 6px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .remove-button:hover {
    background: rgba(255, 68, 68, 0.2);
    color: #ff4444;
  }

  .add-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    background: #4a9eff;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }

  .add-button:hover {
    background: #357abd;
  }

  .add-button.secondary {
    background: rgba(74, 158, 255, 0.2);
    color: #4a9eff;
    border: 1px solid rgba(74, 158, 255, 0.3);
  }

  .add-button.secondary:hover {
    background: rgba(74, 158, 255, 0.3);
  }

  .add-form {
    padding: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid #444;
    border-radius: 8px;
    margin-top: 12px;
  }

  .form-row {
    margin-bottom: 12px;
  }

  .form-row label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: #aaa;
    margin-bottom: 6px;
  }

  .form-row input,
  .form-row textarea {
    width: 100%;
    padding: 10px 12px;
    background: #252526;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    font-family: 'SF Mono', Monaco, monospace;
    box-sizing: border-box;
    resize: vertical;
  }

  .form-row input:focus,
  .form-row textarea:focus {
    outline: none;
    border-color: #4a9eff;
  }

  .form-row input::placeholder {
    color: #666;
  }

  .section h3 small { color: #777; font-weight: 400; }
  .credentials-status { display: flex; flex-wrap: wrap; gap: 8px; color: #ff9b7a; font-size: 12px; }
  .credentials-status span { padding: 4px 8px; background: rgba(255, 90, 70, .1); border-radius: 4px; }
  .credentials-status span.set { color: #79d89a; background: rgba(70, 190, 110, .1); }
  .credentials-status small { flex-basis: 100%; color: #888; }

  .input-with-button {
    display: flex;
    gap: 8px;
  }

  .input-with-button input {
    flex: 1;
  }

  .browse-button {
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid #444;
    border-radius: 4px;
    color: #aaa;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .browse-button:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(255, 68, 68, 0.1);
    border: 1px solid rgba(255, 68, 68, 0.3);
    border-radius: 4px;
    color: #ff6666;
    font-size: 13px;
    margin-bottom: 12px;
  }

  .form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .cancel-button {
    padding: 8px 16px;
    background: transparent;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .cancel-button:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
  }

  .confirm-button {
    padding: 8px 16px;
    background: #4a9eff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }

  .confirm-button:hover {
    background: #357abd;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .info-item {
    padding: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid #333;
    border-radius: 6px;
  }

  .info-label {
    display: block;
    font-size: 12px;
    color: #888;
    margin-bottom: 4px;
  }

  .info-value {
    display: block;
    font-size: 20px;
    font-weight: 600;
    color: #fff;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 20px;
    border-top: 1px solid #333;
  }

  .save-button {
    padding: 10px 20px;
    background: #4a9eff;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }

  .save-button:hover {
    background: #357abd;
  }
</style>
