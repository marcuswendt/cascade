import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker?worker';

interface MonacoEnvironment {
  getWorker(moduleId: string, label: string): Worker;
}

const scope = globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironment };

scope.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === 'typescript' || label === 'javascript'
      ? new TypeScriptWorker()
      : new EditorWorker();
  },
};

export { monaco };
