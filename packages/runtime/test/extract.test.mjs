import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

import { extractNodeDefinition } from "../dist/definition/extract.js";
import { validateNodeModuleArchitecture } from "../dist/definition/architecture.js";

test("extracts the supported TypeScript literal grammar without evaluation", () => {
  globalThis.__cascadeExtractorSentinel = 0;
  const source = `
    globalThis.__cascadeExtractorSentinel += 1;
    export const definition = ({
      apiVersion: 1,
      runsOn: 'portable',
      inputs: { value: { kind: 'data', type: 'float', default: -2 } },
      outputs: { result: { kind: 'data', type: 'float' } },
    } as const) satisfies NodeDefinition;
  `;

  const result = extractNodeDefinition(source, "nodes/Scale/index.ts", ts);
  assert.equal(result.ok, true);
  assert.deepEqual(result.definition.inputs.value.default, -2);
  assert.equal(globalThis.__cascadeExtractorSentinel, 0);
});

test("rejects references, spreads, calls, and duplicate definitions with locations", () => {
  for (const [source, code] of [
    [
      `const value = 2; export const definition = { apiVersion: 1, runsOn: 'portable', value };`,
      "definition/non-literal",
    ],
    [
      `export const definition = { apiVersion: 1, runsOn: 'portable', ...other };`,
      "definition/spread",
    ],
    [`export const definition = makeDefinition();`, "definition/non-literal"],
    [
      `export const definition = {}; export const definition = {};`,
      "definition/duplicate-export",
    ],
  ]) {
    const result = extractNodeDefinition(source, "node.ts", ts);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, code);
    assert.equal(result.diagnostics[0].file, "node.ts");
    assert.ok(result.diagnostics[0].line >= 1);
    assert.ok(result.diagnostics[0].column >= 1);
  }
});

test("rejects duplicate object keys before creating a record", () => {
  const result = extractNodeDefinition(
    `export const definition = { apiVersion: 1, apiVersion: 1, runsOn: 'portable' };`,
    "node.ts",
    ts,
  );
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "definition/duplicate-key");
});

test("accepts only const assertions and reports syntax errors", () => {
  const assertion = extractNodeDefinition(
    `export const definition = ({ apiVersion: 1, runsOn: 'portable' } as NodeDefinition);`,
    "node.ts",
    ts,
  );
  assert.equal(assertion.ok, false);
  assert.equal(assertion.diagnostics[0].code, "definition/non-literal");

  const syntax = extractNodeDefinition(
    `export const definition = { apiVersion: 1, runsOn: ; }`,
    "node.ts",
    ts,
  );
  assert.equal(syntax.ok, false);
  assert.equal(syntax.diagnostics[0].code, "definition/syntax");
});

test("counts transparent wrappers toward the extraction depth limit", () => {
  const wrapped = `${"(".repeat(33)}{ apiVersion: 1, runsOn: 'portable' }${")".repeat(33)}`;
  const result = extractNodeDefinition(
    `export const definition = ${wrapped};`,
    "deep.ts",
    ts,
  );
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "definition/depth-limit");
});

test("rejects hidden module and ambient state while allowing pure helpers", () => {
  const valid = validateNodeModuleArchitecture(`
    import type { NodeDefinition } from 'cascade/contracts';
    export const definition = { apiVersion: 1, runsOn: 'portable' } as const satisfies NodeDefinition;
    function double(value: number) { return value * 2; }
    export function execute(context: unknown) { return double(Number(context)); }
  `, "nodes/Scale/index.ts", ts);
  assert.deepEqual(valid, []);

  for (const [source, code] of [
    ["const cache = new Map();", "architecture/module-state"],
    ["let previous;", "architecture/module-state"],
    ["globalThis.shared = 1;", "architecture/top-level-effect"],
    ["export function execute() { return localStorage.getItem('value'); }", "architecture/ambient-state"],
    ["export async function execute() { return import('./executor'); }", "architecture/dynamic-import"],
    ["import './register';", "architecture/side-effect-import"],
    ["import { execute } from '../Other/index';", "architecture/node-import"],
  ]) {
    const diagnostics = validateNodeModuleArchitecture(source, "nodes/Scale/index.ts", ts);
    assert.ok(diagnostics.some((item) => item.code === code), `${code}: ${JSON.stringify(diagnostics)}`);
  }
});
