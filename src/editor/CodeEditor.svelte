<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import * as monaco from 'monaco-editor';
  import type { Node } from '@/core/Node';
  import PackageSearch from './PackageSearch.svelte';
  import type { PackageManager } from '@/core/PackageManager';
  import Icon from './Icon.svelte';
  import { Clock, Check, XCircle } from 'lucide-svelte';
  
  export let node: Node;
  export let packageManager: PackageManager | null = null;
  export let onClose: () => void;
  
  let container: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let status: 'idle' | 'editing' | 'compiling' | 'success' | 'error' = 'idle';
  let errorMessage = '';
  let isDestroyed = false;
  let packageSearchOpen = false;
  
  onMount(async () => {
    if (!container || isDestroyed) return;
    
    // Wait for DOM to be ready
    await tick();
    
    if (!container || isDestroyed) return;
    
    try {
      editor = monaco.editor.create(container, {
        value: node.code || getDefaultNodeCode(node.type),
        language: 'typescript',
        theme: 'vs-dark',
        minimap: { enabled: false },
        fontSize: 14,
        automaticLayout: true
      });
      
      // Shift+Enter to compile
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        () => {
          if (!isDestroyed && editor) {
            compileNode();
          }
        }
      );
      
      // Escape to close
      editor.addCommand(
        monaco.KeyCode.Escape,
        () => {
          if (!isDestroyed) {
            if (packageSearchOpen) {
              packageSearchOpen = false;
            } else {
              onClose();
            }
          }
        }
      );
      
      // ⌘K / Ctrl+K to open package search
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
        () => {
          if (!isDestroyed) {
            packageSearchOpen = true;
          }
        }
      );
      
      editor.onDidChangeModelContent(() => {
        if (!isDestroyed) {
          status = 'editing';
        }
      });
    } catch (error) {
      console.error('Error creating Monaco editor:', error);
      errorMessage = 'Failed to initialize editor';
      status = 'error';
    }
  });
  
  onDestroy(() => {
    isDestroyed = true;
    if (editor) {
      try {
        editor.dispose();
      } catch (error) {
        // Ignore disposal errors
        console.warn('Error disposing Monaco editor:', error);
      }
      editor = null;
    }
  });
  
  async function compileNode() {
    if (!editor || isDestroyed) return;
    
    let code: string;
    try {
      code = editor.getValue();
    } catch (error) {
      console.error('Error getting editor value:', error);
      return;
    }
    
    status = 'compiling';
    
    try {
      // Preserve state
      const oldState = node.preserveState();
      
      // Call onDestroy
      if (node.onDestroy) {
        try {
          node.onDestroy();
        } catch (err) {
          console.warn('Error in node.onDestroy:', err);
        }
      }
      
      // Compile new function
      // Wrap code in async function to support top-level await
      // The function should return a promise that resolves when the async code completes
      const wrappedCode = `return (async function(node, graph) {\n${code}\n})(node, graph);`;
      const nodeFunction = new Function('node', 'graph', wrappedCode) as (node: any, graph: any) => Promise<any>;
      
      // Update node
      node.code = code;
      node.setFunction(nodeFunction);
      
      // Execute to initialize
      await node.execute();
      
      // Restore state
      node.restoreState(oldState);
      
      // Call onReady
      if (node.onReady) {
        try {
          node.onReady();
        } catch (err) {
          console.warn('Error in node.onReady:', err);
        }
      }
      
      if (isDestroyed) return;
      
      status = 'success';
      errorMessage = '';
      
      setTimeout(() => {
        if (status === 'success' && !isDestroyed) {
          onClose();
        }
      }, 1000);
      
    } catch (error: any) {
      if (isDestroyed) return;
      
      status = 'error';
      errorMessage = error.message || 'Unknown error';
      node.error = error;
      console.error('Error compiling node:', error);
    }
  }
  
  function getDefaultNodeCode(type: string): string {
    return `// ${type} node
const trigger = node.in('trigger', null, { type: 'trigger' });
const output = node.out('output');

// Handle triggers
if (trigger) {
  trigger.onTrigger = () => {
    // Your code here
    output.setValue('Hello World');
  };
}

// Lifecycle
node.onReady = () => {
  console.log('Node ready');
};
`;
  }

  function handlePackageSelect(e: CustomEvent<{ packageName: string }>) {
    if (!editor) return;
    
    const packageName = e.detail.packageName;
    const model = editor.getModel();
    if (!model) return;
    
    const selection = editor.getSelection();
    if (!selection) return;
    
    // Insert require statement at cursor or top of file
    const requireCode = `const ${packageName.replace(/[^a-zA-Z0-9]/g, '_')} = await node.require('${packageName}');\n`;
    
    // If there's a selection, replace it, otherwise insert at cursor
    if (selection.isEmpty()) {
      // Insert at cursor position
      editor.executeEdits('insert-package', [{
        range: new monaco.Range(selection.startLineNumber, selection.startColumn, selection.startLineNumber, selection.startColumn),
        text: requireCode
      }]);
    } else {
      // Replace selection
      editor.executeEdits('insert-package', [{
        range: selection,
        text: requireCode
      }]);
    }
    
    // Move cursor after inserted text
    const newPosition = {
      lineNumber: selection.startLineNumber,
      column: selection.startColumn + requireCode.length
    };
    editor.setPosition(newPosition);
    editor.focus();
  }
</script>

<div class="editor-modal">
  <div class="header">
    <h3>Edit: {node.name}</h3>
    <div class="status status-{status}">
      {#if status === 'editing'}
        Editing... (Shift+Enter to compile)
      {:else if status === 'compiling'}
        <Clock size={14} style="display: inline-block; vertical-align: middle; margin-right: 4px;" />
        Compiling...
      {:else if status === 'success'}
        <Check size={14} style="display: inline-block; vertical-align: middle; margin-right: 4px;" />
        Success!
      {:else if status === 'error'}
        <XCircle size={14} style="display: inline-block; vertical-align: middle; margin-right: 4px;" />
        {errorMessage}
      {/if}
    </div>
    <button on:click={onClose} class="close-button">×</button>
  </div>
  
  <div class="editor-container" bind:this={container}></div>
  
  <div class="footer">
    <button class="package-button" on:click={() => packageSearchOpen = true} title="Search NPM packages (⌘K)">
      <Icon name="Package" size={14} style="display: inline-block; vertical-align: middle; margin-right: 6px;" />
      Packages
    </button>
    <div class="footer-right">
      <button on:click={compileNode} disabled={!editor || isDestroyed}>
        Compile (Shift+Enter)
      </button>
      <button on:click={onClose}>
        Close (Esc)
      </button>
    </div>
  </div>
</div>

{#if packageManager}
  <PackageSearch
    bind:open={packageSearchOpen}
    {packageManager}
    on:select={handlePackageSelect}
    on:close={() => packageSearchOpen = false}
  />
{/if}

<style>
  .editor-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 800px;
    height: 600px;
    background: #1e1e1e;
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    z-index: 1000;
  }
  
  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    border-bottom: 1px solid #333;
  }
  
  .header h3 {
    margin: 0;
    color: #fff;
    font-size: 16px;
  }
  
  .status {
    flex: 1;
    font-size: 14px;
    color: #888;
  }
  
  .status-error {
    color: #ff4444;
  }
  
  .status-success {
    color: #44ff44;
  }
  
  .editor-container {
    flex: 1;
    min-height: 0;
  }
  
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid #333;
  }

  .footer-right {
    display: flex;
    gap: 8px;
  }

  .package-button {
    padding: 8px 16px;
    background: rgba(74, 158, 255, 0.2);
    color: #4a9eff;
    border: 1px solid rgba(74, 158, 255, 0.3);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
  }

  .package-button:hover {
    background: rgba(74, 158, 255, 0.3);
    border-color: #4a9eff;
  }
  
  button {
    padding: 8px 16px;
    background: #4a9eff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }
  
  button:hover:not(:disabled) {
    background: #357abd;
  }
  
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .close-button {
    margin-left: auto;
    background: transparent;
    font-size: 24px;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .close-button:hover {
    background: rgba(255, 255, 255, 0.1);
  }
</style>

