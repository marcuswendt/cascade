/**
 * File system utilities for saving and loading graphs
 */

import type { Graph } from '@/nodes/Graph';

/**
 * Format JSON string with compact arrays (keeps small arrays on single lines)
 * This function finds multi-line arrays with 2-4 elements and compacts them
 * Handles both numeric arrays and arrays containing small arrays (like connections)
 */
export function formatCompactJSON(jsonString: string, indent: number = 2): string {
  // Process multiple passes to handle nested arrays
  let result = jsonString;
  let previousResult = '';
  
  // Keep processing until no more changes (handles nested arrays)
  while (result !== previousResult) {
    previousResult = result;
    result = formatCompactJSONPass(result, indent);
  }
  
  return result;
}

/**
 * Single pass of compact formatting
 */
function formatCompactJSONPass(jsonString: string, indent: number = 2): string {
  const lines = jsonString.split('\n');
  const result: string[] = [];
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Check if this line starts an array (pattern: "key": [ or just [)
    if (trimmed.endsWith('[') && (trimmed.includes(':') || trimmed === '[')) {
      // Collect lines until we find the closing bracket
      let arrayLines: string[] = [line];
      let bracketDepth = 1;
      let j = i + 1;
      
      while (j < lines.length && bracketDepth > 0) {
        const currentLine = lines[j];
        arrayLines.push(currentLine);
        
        // Count bracket depth
        for (const char of currentLine) {
          if (char === '[') bracketDepth++;
          if (char === ']') bracketDepth--;
        }
        j++;
      }
      
      // Extract array content (lines between opening and closing brackets)
      // Handle nested arrays by extracting complete array elements
      const arrayContent: string[] = [];
      let k = 1;
      while (k < arrayLines.length - 1) {
        const currentLine = arrayLines[k].trim();
        
        // Check if this line starts a nested array
        if (currentLine.endsWith('[') || (currentLine.startsWith('[') && !currentLine.endsWith(']'))) {
          // Extract the complete nested array
          let nestedArrayLines: string[] = [arrayLines[k]];
          let nestedDepth = 1;
          let m = k + 1;
          
          while (m < arrayLines.length - 1 && nestedDepth > 0) {
            nestedArrayLines.push(arrayLines[m]);
            for (const char of arrayLines[m]) {
              if (char === '[') nestedDepth++;
              if (char === ']') nestedDepth--;
            }
            m++;
          }
          
          // Join nested array lines into a single compact representation
          const nestedContent: string[] = [];
          for (let n = 1; n < nestedArrayLines.length - 1; n++) {
            const nestedLine = nestedArrayLines[n].trim().replace(/,$/, '').trim();
            if (nestedLine) {
              nestedContent.push(nestedLine);
            }
          }
          
          // Create compact nested array string
          const nestedArray = '[' + nestedContent.map(c => c.trim()).join(', ') + ']';
          arrayContent.push(nestedArray);
          k = m;
        } else {
          // Simple element
          const content = currentLine.replace(/,$/, '').trim();
          if (content) {
            arrayContent.push(content);
          }
          k++;
        }
      }
      
      // Check if it's a small numeric array (2-4 elements)
      const isSmallNumericArray = arrayContent.length >= 2 && 
                                  arrayContent.length <= 4 &&
                                  arrayContent.every(item => {
                                    const trimmed = item.trim();
                                    return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed);
                                  });
      
      // Check if it's an array containing small arrays (like connections: [[a, b], [c, d]])
      // Look for patterns where each element is a small array (2-4 elements)
      // This handles both already-compacted arrays and multi-line nested arrays
      let isArrayOfSmallArrays = false;
      if (arrayContent.length >= 2 && arrayContent.length <= 20) { // Reasonable limit for connections
        // Check if elements are arrays (either compact or multi-line)
        const allAreArrays = arrayContent.every(item => {
          const trimmed = item.trim();
          // Already compact array like [a, b] or ["a", 0]
          if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            const inner = trimmed.slice(1, -1).trim();
            const parts = inner.split(',').map(p => p.trim()).filter(p => p);
            return parts.length >= 2 && parts.length <= 4;
          }
          // Multi-line array - check if this line starts an array
          if (trimmed.endsWith('[')) {
            return true; // This will be handled in a later pass
          }
          return false;
        });
        
        if (allAreArrays) {
          // Check if inner arrays are small (2-4 elements each)
          // For multi-line arrays, we'll need to extract their content
          let allSmall = true;
          for (const item of arrayContent) {
            const trimmed = item.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
              // Already compact - check size
              const inner = trimmed.slice(1, -1).trim();
              const parts = inner.split(',').map(p => p.trim()).filter(p => p);
              if (parts.length < 2 || parts.length > 4) {
                allSmall = false;
                break;
              }
            } else if (trimmed.endsWith('[')) {
              // Multi-line array - will be compacted in next pass, assume it's small for now
              // We'll handle this in the multi-pass approach
            } else {
              allSmall = false;
              break;
            }
          }
          isArrayOfSmallArrays = allSmall;
        }
      }
      
      if (isSmallNumericArray || isArrayOfSmallArrays) {
        // Compact format: put entire array on one line
        const indentLevel = (line.match(/^(\s*)/)?.[1] || '').length;
        // Extract the key part (everything before the opening bracket)
        const keyMatch = trimmed.match(/^(.+?)\s*\[\s*$/);
        const keyPart = keyMatch ? keyMatch[1] : '';
        
        // Check if the closing bracket line has a comma (last line in arrayLines)
        const closingLine = arrayLines[arrayLines.length - 1];
        const hasComma = closingLine.trim().endsWith(',');
        
        // Format array content
        let formattedContent: string;
        if (isArrayOfSmallArrays) {
          // For arrays of arrays, each element should be compact
          // If an element is a multi-line array (ends with [), we can't compact it yet
          // Otherwise, use the already-compact form
          formattedContent = arrayContent.map(c => {
            const trimmed = c.trim();
            // If it's already compact, use it as-is
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
              return trimmed;
            }
            // If it's a multi-line array start, we'll need another pass
            // For now, return as-is (will be handled in next pass)
            return trimmed;
          }).join(', ');
        } else {
          // Simple numeric array
          formattedContent = arrayContent.map(c => c.trim()).join(', ');
        }
        
        const compactArray = keyPart + ' [' + formattedContent + ']' + (hasComma ? ',' : '');
        result.push(' '.repeat(indentLevel) + compactArray);
        i = j; // Skip the processed lines
        continue;
      }
    }
    
    result.push(line);
    i++;
  }
  
  return result.join('\n');
}

/**
 * Serialize graph to JSON string (compact format)
 */
export function serializeGraph(graph: Graph): string {
  const json = graph.toJSON();
  const jsonString = JSON.stringify(json, null, 2);
  return formatCompactJSON(jsonString, 2);
}

/**
 * Save graph as JSON file (browser download fallback)
 */
export function saveGraph(graph: Graph, filename: string = 'graph.cascade') {
  const compactJsonString = serializeGraph(graph);
  const blob = new Blob([compactJsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Save graph using File System Access API (modern browsers)
 * Returns the chosen filename, or null if cancelled
 */
export async function saveGraphWithPicker(graph: Graph, suggestedName: string = 'graph.cascade'): Promise<string | null> {
  // Check if File System Access API is supported
  if (!('showSaveFilePicker' in window)) {
    // Fall back to download approach
    saveGraph(graph, suggestedName);
    return suggestedName;
  }

  try {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName,
      types: [{
        description: 'Cascade Files',
        accept: { 'application/json': ['.cascade'] }
      }]
    });

    const writable = await handle.createWritable();
    const content = serializeGraph(graph);
    await writable.write(content);
    await writable.close();

    return handle.name;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // User cancelled
      return null;
    }
    throw err;
  }
}

/**
 * Load graph from JSON file
 */
export function loadGraphFromFile(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        resolve(json);
      } catch (error) {
        reject(new Error('Failed to parse JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Trigger file input dialog
 */
export function triggerFileInput(accept: string = '.cascade'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0] || null;
      resolve(file);
    };
    input.click();
  });
}

/**
 * Get filename from path or default
 */
export function getFilenameFromPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || 'Untitled';
}

/**
 * Remove extension from filename
 */
export function removeExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
}



