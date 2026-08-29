import { describe, expect, it, vi } from 'vitest';

vi.mock('monaco-editor', () => ({ editor: {}, typescript: {} }));
vi.mock('monaco-editor/editor/editor.worker?worker', () => ({
  default: class EditorWorker { readonly kind = 'editor'; },
}));
vi.mock('monaco-editor/language/typescript/ts.worker?worker', () => ({
  default: class TypeScriptWorker { readonly kind = 'typescript'; },
}));

describe('Monaco native worker routing', () => {
  it('uses the TypeScript worker only for TypeScript-family languages', async () => {
    await import('../src/editor/monaco');
    const environment = (globalThis as typeof globalThis & {
      MonacoEnvironment: { getWorker(moduleId: string, label: string): { kind: string } };
    }).MonacoEnvironment;

    expect(environment.getWorker('', 'typescript').kind).toBe('typescript');
    expect(environment.getWorker('', 'javascript').kind).toBe('typescript');
    expect(environment.getWorker('', 'json').kind).toBe('editor');
  });
});
