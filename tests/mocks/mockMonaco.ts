/**
 * Mock Monaco Editor for testing
 * Provides a mock implementation of the Monaco editor API
 */

import { vi } from 'vitest';

export interface MockMonacoEditor {
  getValue: ReturnType<typeof vi.fn>;
  setValue: ReturnType<typeof vi.fn>;
  updateOptions: ReturnType<typeof vi.fn>;
  addCommand: ReturnType<typeof vi.fn>;
  onDidChangeModelContent: ReturnType<typeof vi.fn>;
  onDidFocusEditorText: ReturnType<typeof vi.fn>;
  onDidBlurEditorText: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  getModel: ReturnType<typeof vi.fn>;
  layout: ReturnType<typeof vi.fn>;
  getPosition: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  revealLine: ReturnType<typeof vi.fn>;
  _commandCallbacks: Map<number, () => void>;
  _value: string;
}

/**
 * Create a mock Monaco editor instance
 */
export function createMockMonacoEditor(initialValue = ''): MockMonacoEditor {
  let value = initialValue;
  const commandCallbacks = new Map<number, () => void>();
  let commandId = 0;

  const editor: MockMonacoEditor = {
    _value: value,
    _commandCallbacks: commandCallbacks,

    getValue: vi.fn(() => value),
    setValue: vi.fn((newValue: string) => {
      value = newValue;
      editor._value = newValue;
    }),
    updateOptions: vi.fn(),
    addCommand: vi.fn((keybinding: number, callback: () => void) => {
      const id = ++commandId;
      commandCallbacks.set(id, callback);
      return id;
    }),
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    onDidFocusEditorText: vi.fn(() => ({ dispose: vi.fn() })),
    onDidBlurEditorText: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
    focus: vi.fn(),
    getModel: vi.fn(() => ({
      uri: { path: '/test-model' },
      getValue: () => value,
      getLineCount: () => value.split('\n').length,
    })),
    layout: vi.fn(),
    getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
    setPosition: vi.fn(),
    revealLine: vi.fn(),
  };

  return editor;
}

/**
 * Trigger a command registered with addCommand
 */
export function triggerCommand(editor: MockMonacoEditor, commandId: number): void {
  const callback = editor._commandCallbacks.get(commandId);
  if (callback) {
    callback();
  }
}

/**
 * Create mock Monaco module for vi.mock('monaco-editor')
 */
export function createMockMonacoModule() {
  return {
    editor: {
      create: vi.fn((container: HTMLElement, options?: { value?: string }) =>
        createMockMonacoEditor(options?.value ?? '')
      ),
      defineTheme: vi.fn(),
      setTheme: vi.fn(),
      createModel: vi.fn((value: string) => ({
        getValue: () => value,
        uri: { path: '/model' },
      })),
    },
    typescript: {
      typescriptDefaults: {
        setCompilerOptions: vi.fn(),
        setExtraLibs: vi.fn(),
        addExtraLib: vi.fn(),
        setDiagnosticsOptions: vi.fn(),
      },
      javascriptDefaults: {
        setCompilerOptions: vi.fn(),
        setExtraLibs: vi.fn(),
      },
    },
    languages: {
      register: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      setLanguageConfiguration: vi.fn(),
    },
    KeyMod: {
      CtrlCmd: 2048,
      Shift: 1024,
      Alt: 512,
      WinCtrl: 256,
    },
    KeyCode: {
      Enter: 3,
      Escape: 9,
      KeyK: 36,
      KeyS: 49,
    },
    Uri: {
      parse: vi.fn((path: string) => ({ path })),
    },
  };
}
