/**
 * CodeHistory - Version management for embedded node code
 *
 * Tracks changes to embedded code with support for:
 * - User edits
 * - Agent-authored code (with prompt tracking)
 * - Undo/restore functionality
 * - Diff generation
 */

import type { CodeVersion } from '../types/node.types.js';

export interface HistoryEntry extends CodeVersion {
  id: string;
  parentId?: string;  // For branching history
}

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  lineNumber: number;
  content: string;
}

export interface CodeDiff {
  oldCode: string;
  newCode: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

export class CodeHistory {
  private entries: HistoryEntry[] = [];
  private currentIndex: number = -1;
  private idCounter: number = 0;
  private maxEntries: number;

  constructor(maxEntries: number = 100) {
    this.maxEntries = maxEntries;
  }

  /**
   * Generate a unique ID for history entries
   */
  private generateId(): string {
    return `v_${Date.now()}_${++this.idCounter}`;
  }

  /**
   * Add a new version to history
   */
  addVersion(
    code: string,
    author: 'user' | 'ai',
    prompt?: string
  ): HistoryEntry {
    const entry: HistoryEntry = {
      id: this.generateId(),
      code,
      timestamp: new Date().toISOString(),
      author,
      prompt,
      parentId: this.currentIndex >= 0 ? this.entries[this.currentIndex].id : undefined
    };

    // If we're not at the end, truncate future history (linear history)
    if (this.currentIndex < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.currentIndex + 1);
    }

    this.entries.push(entry);
    this.currentIndex = this.entries.length - 1;

    // Prune old entries if over limit
    if (this.entries.length > this.maxEntries) {
      const excess = this.entries.length - this.maxEntries;
      this.entries = this.entries.slice(excess);
      this.currentIndex -= excess;
    }

    return entry;
  }

  /**
   * Get the current version
   */
  getCurrentVersion(): HistoryEntry | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.entries.length) {
      return null;
    }
    return this.entries[this.currentIndex];
  }

  /**
   * Get current code
   */
  getCurrentCode(): string | null {
    const current = this.getCurrentVersion();
    return current?.code || null;
  }

  /**
   * Get all history entries
   */
  getHistory(): HistoryEntry[] {
    return [...this.entries];
  }

  /**
   * Get history entry by index
   */
  getVersion(index: number): HistoryEntry | null {
    if (index < 0 || index >= this.entries.length) {
      return null;
    }
    return this.entries[index];
  }

  /**
   * Get history entry by ID
   */
  getVersionById(id: string): HistoryEntry | null {
    return this.entries.find(e => e.id === id) || null;
  }

  /**
   * Get the current index
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Get total number of versions
   */
  getVersionCount(): number {
    return this.entries.length;
  }

  /**
   * Check if can undo
   */
  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  /**
   * Check if can redo
   */
  canRedo(): boolean {
    return this.currentIndex < this.entries.length - 1;
  }

  /**
   * Undo to previous version
   */
  undo(): HistoryEntry | null {
    if (!this.canUndo()) {
      return null;
    }
    this.currentIndex--;
    return this.getCurrentVersion();
  }

  /**
   * Redo to next version
   */
  redo(): HistoryEntry | null {
    if (!this.canRedo()) {
      return null;
    }
    this.currentIndex++;
    return this.getCurrentVersion();
  }

  /**
   * Restore to a specific version by index
   * This adds a new entry pointing to the restored version's code
   */
  restoreToIndex(index: number): HistoryEntry | null {
    const version = this.getVersion(index);
    if (!version) {
      return null;
    }

    // Add a new entry with the restored code
    return this.addVersion(version.code, 'user');
  }

  /**
   * Restore to a specific version by ID
   */
  restoreToId(id: string): HistoryEntry | null {
    const index = this.entries.findIndex(e => e.id === id);
    if (index < 0) {
      return null;
    }
    return this.restoreToIndex(index);
  }

  /**
   * Generate a simple line-based diff between two code versions
   */
  static generateDiff(oldCode: string, newCode: string): CodeDiff {
    const oldLines = oldCode.split('\n');
    const newLines = newCode.split('\n');
    const diffLines: DiffLine[] = [];
    let additions = 0;
    let deletions = 0;

    // Simple LCS-based diff (not optimal but functional)
    const lcs = CodeHistory.computeLCS(oldLines, newLines);

    let oldIdx = 0;
    let newIdx = 0;
    let lcsIdx = 0;
    let lineNum = 1;

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
        if (newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
          // Unchanged line
          diffLines.push({
            type: 'unchanged',
            lineNumber: lineNum++,
            content: oldLines[oldIdx]
          });
          oldIdx++;
          newIdx++;
          lcsIdx++;
        } else if (newIdx < newLines.length) {
          // Added line
          diffLines.push({
            type: 'added',
            lineNumber: lineNum++,
            content: newLines[newIdx]
          });
          additions++;
          newIdx++;
        }
      } else if (oldIdx < oldLines.length) {
        // Removed line
        diffLines.push({
          type: 'removed',
          lineNumber: lineNum,
          content: oldLines[oldIdx]
        });
        deletions++;
        oldIdx++;
      } else if (newIdx < newLines.length) {
        // Added line
        diffLines.push({
          type: 'added',
          lineNumber: lineNum++,
          content: newLines[newIdx]
        });
        additions++;
        newIdx++;
      }
    }

    return {
      oldCode,
      newCode,
      lines: diffLines,
      additions,
      deletions
    };
  }

  /**
   * Compute Longest Common Subsequence for diff
   */
  private static computeLCS(arr1: string[], arr2: string[]): string[] {
    const m = arr1.length;
    const n = arr2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (arr1[i - 1] === arr2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to find LCS
    const lcs: string[] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (arr1[i - 1] === arr2[j - 1]) {
        lcs.unshift(arr1[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return lcs;
  }

  /**
   * Generate diff between current version and another version
   */
  diffWithVersion(index: number): CodeDiff | null {
    const current = this.getCurrentVersion();
    const other = this.getVersion(index);

    if (!current || !other) {
      return null;
    }

    return CodeHistory.generateDiff(other.code, current.code);
  }

  /**
   * Get recent agent-authored versions with their prompts
   */
  getAIVersions(): HistoryEntry[] {
    return this.entries.filter(e => e.author === 'ai');
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.entries = [];
    this.currentIndex = -1;
  }

  /**
   * Initialize from existing CodeVersion array
   */
  initFromVersions(versions: CodeVersion[]): void {
    this.clear();
    versions.forEach(v => {
      const entry: HistoryEntry = {
        id: this.generateId(),
        ...v,
        parentId: this.currentIndex >= 0 ? this.entries[this.currentIndex].id : undefined
      };
      this.entries.push(entry);
      this.currentIndex = this.entries.length - 1;
    });
  }

  /**
   * Export to CodeVersion array for serialization
   */
  toVersions(): CodeVersion[] {
    return this.entries.map(e => ({
      code: e.code,
      timestamp: e.timestamp,
      author: e.author,
      prompt: e.prompt
    }));
  }

  /**
   * Get a summary of history for display
   */
  getSummary(): Array<{
    index: number;
    id: string;
    timestamp: string;
    author: 'user' | 'ai';
    prompt?: string;
    isCurrent: boolean;
  }> {
    return this.entries.map((entry, index) => ({
      index,
      id: entry.id,
      timestamp: entry.timestamp,
      author: entry.author,
      prompt: entry.prompt,
      isCurrent: index === this.currentIndex
    }));
  }
}

/**
 * Create a CodeHistory instance initialized with existing versions
 */
export function createCodeHistory(
  versions?: CodeVersion[],
  maxEntries?: number
): CodeHistory {
  const history = new CodeHistory(maxEntries);
  if (versions && versions.length > 0) {
    history.initFromVersions(versions);
  }
  return history;
}
