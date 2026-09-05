<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  
  interface LogEntry {
    id: string;
    timestamp: Date;
    level: 'log' | 'warn' | 'error';
    source: string | null;
    args: any[];
    formatted: string;
  }
  
  let logEntries: LogEntry[] = [];
  let logContainer: HTMLDivElement;
  let autoScroll = true;
  
  // Store original console methods
  let originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  };
  
  function formatLogEntry(level: 'log' | 'warn' | 'error', args: any[]): { source: string | null; formatted: string } {
    // Check if first arg is a node log format: [NodeName] ...
    let source: string | null = null;
    let formattedArgs = args;
    
    if (args.length > 0 && typeof args[0] === 'string') {
      const match = args[0].match(/^\[([^\]]+)\]/);
      if (match) {
        source = match[1];
        formattedArgs = args.slice(1);
      }
    }
    
    // Format the message
    const formatted = formattedArgs.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    return { source, formatted };
  }
  
  function addLogEntry(level: 'log' | 'warn' | 'error', ...args: any[]) {
    const { source, formatted } = formatLogEntry(level, args);
    
    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      level,
      source,
      args,
      formatted
    };
    
    logEntries = [...logEntries, entry];
    
    // Keep only last 1000 entries
    if (logEntries.length > 1000) {
      logEntries = logEntries.slice(-1000);
    }
    
    // Call original console method
    if (originalConsole) {
      originalConsole[level](...args);
    }
    
    // Auto-scroll to bottom
    if (autoScroll && logContainer) {
      setTimeout(() => {
        if (logContainer) {
          logContainer.scrollTop = logContainer.scrollHeight;
        }
      }, 0);
    }
  }
  
  function handleScroll() {
    if (!logContainer) return;
    const isAtBottom = logContainer.scrollHeight - logContainer.scrollTop <= logContainer.clientHeight + 10;
    autoScroll = isAtBottom;
  }
  
  export function clearLog() {
    logEntries = [];
  }
  
  function getLevelClass(level: string): string {
    switch (level) {
      case 'error': return 'error';
      case 'warn': return 'warn';
      default: return 'log';
    }
  }
  
  onMount(() => {
    // Store original console methods
    originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    };
    
    // Override console methods
    console.log = (...args: any[]) => {
      addLogEntry('log', ...args);
    };
    
    console.warn = (...args: any[]) => {
      addLogEntry('warn', ...args);
    };
    
    console.error = (...args: any[]) => {
      addLogEntry('error', ...args);
    };
    
    // Add scroll listener
    if (logContainer) {
      logContainer.addEventListener('scroll', handleScroll);
    }
  });
  
  onDestroy(() => {
    // Restore original console methods
    if (originalConsole) {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
    }
    
    if (logContainer) {
      logContainer.removeEventListener('scroll', handleScroll);
    }
  });
</script>

<div class="log">
  <div class="log-content" bind:this={logContainer}>
    {#if logEntries.length > 0}
      {#each logEntries as entry (entry.id)}
        <div class="log-entry" class:error={entry.level === 'error'} class:warn={entry.level === 'warn'}>
          {#if entry.source}
            <span class="log-source">[{entry.source}]</span>
          {/if}
          <span class="log-message" class:error={entry.level === 'error'} class:warn={entry.level === 'warn'}>
            {entry.formatted}
          </span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .log {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--surface-void);
    color: var(--text-bright);
  }
  
  .log-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 8px;
    font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    font-size: 11px;
    line-height: 1.6;
  }
  
  .log-entry {
    display: flex;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid var(--tint-weak);
    word-break: break-word;
  }
  
  .log-entry:last-child {
    border-bottom: none;
  }
  
  .log-source {
    color: var(--accent);
    flex-shrink: 0;
    font-weight: 500;
  }
  
  .log-message {
    flex: 1;
    color: var(--text-secondary);
  }
  
  .log-message.error {
    color: var(--status-error);
  }
  
  .log-message.warn {
    color: var(--status-attention);
  }
  
  .log-entry.error {
    background: var(--status-error-tint-weak);
  }
  
  .log-entry.warn {
    background: var(--status-warn-tint-weak);
  }
  
  .log-content::-webkit-scrollbar {
    width: 8px;
  }
  
  .log-content::-webkit-scrollbar-track {
    background: var(--shade-weakest);
  }
  
  .log-content::-webkit-scrollbar-thumb {
    background: var(--tint-strong);
    border-radius: 4px;
  }
  
  .log-content::-webkit-scrollbar-thumb:hover {
    background: var(--tint-stronger);
  }
</style>
