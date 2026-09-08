import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkProjectGraph, classifyPreflight, inspectProjectGraph, renderDeterministicProjectFrames, runDeterministicProjectGraph, validateProjectGraph } from '@/cli/projectRuntime';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(source: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-cli-runtime-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'nodes', 'Multiply'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nodes', 'Multiply', 'index.ts'), source);
  const file = path.join(root, 'index.cascade');
  const document = { version: '0.2', nodes: [{ id: 'multiply', module: 'project.Multiply' }], connections: [] };
  fs.writeFileSync(file, JSON.stringify(document));
  return { root, file, document };
}

const validSource = `
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  inputs: { value: { kind: 'data', type: 'float', default: 2 } },
  outputs: { result: { kind: 'data', type: 'float' } }
} as const;
export function execute(context) {
  context.outputs.result.set(context.inputs.value * 2);
}
`;

describe('deterministic CLI runtime', () => {
  it('names the path it looked for when a module has no file', async () => {
    // `prepare` falls back to a definition synthesised from the ports the
    // document saved, which is what keeps a legacy node loadable — and is also
    // what let a typo validate clean. The path is in the message because
    // `project.Multply` only reads as a typo once you see it went looking for
    // nodes/Multply/index.ts.
    const fixture = project(validSource);
    const typo = { ...fixture.document, nodes: [{ id: 'multiply', module: 'project.Multply' }] };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await validateProjectGraph(fixture.file, typo);

    const printed = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).toContain('One node names a module with no file');
    expect(printed).toContain('project/module-not-found');
    expect(printed).toContain(path.join('nodes', 'Multply', 'index.ts'));
    warn.mockRestore();
  });

  it('says nothing about a module it did resolve', async () => {
    const fixture = project(validSource);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await validateProjectGraph(fixture.file, fixture.document);

    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain('module-not-found');
    warn.mockRestore();
  });

  it('validates definitions and graph structure without evaluating modules', async () => {
    const fixture = project(validSource);
    await validateProjectGraph(fixture.file, fixture.document);
  });

  it('rejects hidden module state and ambient globals', async () => {
    const moduleState = project(validSource.replace(
      'export const definition',
      'const cache = new Map();\nexport const definition',
    ));
    await expect(checkProjectGraph(moduleState.file, moduleState.document)).rejects.toThrow('architecture/module-state');

    const ambientState = project(validSource.replace(
      'context.outputs.result.set',
      'localStorage.setItem("result", "1");\n  context.outputs.result.set',
    ));
    await expect(checkProjectGraph(ambientState.file, ambientState.document)).rejects.toThrow('architecture/ambient-state');
  });

  it('runs a fully deterministic graph through the headless runtime', async () => {
    const fixture = project(validSource);
    await expect(runDeterministicProjectGraph(fixture.file, fixture.document)).resolves.toBe(true);
  });

  it('recognizes reserved core nodes without project modules', async () => {
    const fixture = project(validSource);
    fixture.document = {
      version: '0.2',
      nodes: [
        { id: 'input', module: 'cascade.core.Input', inputs: { value: 0.25 } },
        { id: 'remap', module: 'cascade.core.Remap', inputs: { inMin: 0, inMax: 1, outMin: 0, outMax: 100 } },
        { id: 'output', module: 'cascade.core.Output' },
      ],
      connections: [
        [['input', 0, 'output'], ['remap', 0, 'value']],
        [['remap', 0, 'result'], ['output', 0, 'input']],
      ],
    } as any;

    await expect(checkProjectGraph(fixture.file, fixture.document)).resolves.toBeUndefined();
    await expect(runDeterministicProjectGraph(fixture.file, fixture.document)).resolves.toBe(true);
    await expect(inspectProjectGraph(fixture.file, fixture.document)).resolves.toMatchObject({
      deterministic: true,
      nodes: [
        { classification: 'definition-v1' },
        { classification: 'definition-v1' },
        { classification: 'definition-v1' },
      ],
    });
  });

  it('never falls back when a declared deterministic definition is malformed', async () => {
    const fixture = project(`
      export const definition = makeDefinition();
      export function execute() {}
    `);
    await expect(validateProjectGraph(fixture.file, fixture.document)).rejects.toThrow('definition/non-literal');
  });

  it('rejects mixed deterministic and dynamic execution explicitly', async () => {
    const fixture = project(validSource);
    fixture.document.nodes.push({ id: 'legacy', module: 'cascade.core.Value' });
    await expect(runDeterministicProjectGraph(fixture.file, fixture.document)).rejects.toThrow(/Mixed deterministic and dynamic/);
  });

  it('keeps document validation compatible but rejects dynamic modules during static check', async () => {
    const fixture = project(validSource);
    fixture.document.nodes.push({ id: 'legacy', module: 'cascade.core.Value' });

    await expect(validateProjectGraph(fixture.file, fixture.document)).resolves.toBeUndefined();
    await expect(checkProjectGraph(fixture.file, fixture.document)).rejects.toThrow(/dynamic modules: cascade\.core\.Value/);
  });

  it('validates legacy tuple connections when nodes do not persist port metadata', async () => {
    const fixture = project(validSource);
    fixture.document = {
      version: '0.2',
      nodes: [
        { id: 'source', module: 'cascade.core.Value' },
        { id: 'target', module: 'cascade.core.Value' },
      ],
      connections: [[['source', 0, 'value'], ['target', 0, 'value']]],
    } as any;

    await expect(validateProjectGraph(fixture.file, fixture.document)).resolves.toBeUndefined();
    fixture.document.connections[0][1][0] = 'missing';
    await expect(validateProjectGraph(fixture.file, fixture.document)).rejects.toThrow(/unknown node/);
  });

  // `validate` and `check` exist to say whether a graph will run, and until
  // now neither of them asked a host what it could supply. `MediaCapability`
  // is declared in the contract and implemented by nobody, so this graph
  // passed both commands and then failed on the first run with
  // "Missing capability media for project.Thumbnail".
  it('fails validate and check when a node needs a capability the run host does not install', async () => {
    const fixture = project(`
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  capabilities: ['media'],
  inputs: { image: { kind: 'data', type: 'image' } },
  outputs: { out: { kind: 'data', type: 'image' } }
} as const;
export async function execute(context) {
  const lease = await context.capabilities.media.decodeImage(context.inputs.image, { signal: context.signal });
  lease.release();
  context.outputs.out.set(context.inputs.image);
}
`);
    await expect(validateProjectGraph(fixture.file, fixture.document)).rejects.toThrow(/Missing capability media for project\.Multiply \(node multiply\)/);
    await expect(checkProjectGraph(fixture.file, fixture.document)).rejects.toThrow(/the server host provides assets, shell/);
    // And the run it was blind to fails for the same reason, which is the point.
    await expect(runDeterministicProjectGraph(fixture.file, fixture.document)).rejects.toThrow(/Missing capability media/);
  });

  // The capabilities the CLI host does install must not become errors, or the
  // checker cries wolf and gets ignored.
  it('passes a graph whose declared capabilities the run host installs', async () => {
    const fixture = project(`
export const definition = {
  apiVersion: 1,
  runsOn: 'server',
  capabilities: ['shell', 'assets'],
  inputs: { go: { kind: 'data', type: 'float', default: 1 } },
  outputs: { out: { kind: 'data', type: 'string' } }
} as const;
export async function execute(context) {
  const result = await context.capabilities.shell.run('echo', ['hi']);
  context.outputs.out.set(result.stdout);
}
`);
    await expect(validateProjectGraph(fixture.file, fixture.document)).resolves.toBeUndefined();
    await expect(checkProjectGraph(fixture.file, fixture.document)).resolves.toBeUndefined();
  });

  // A node that says it only runs in the browser is not defective because
  // somebody validated it from a terminal. Warned about, never failed.
  it('warns rather than fails when a node targets a host the CLI is not', async () => {
    const fixture = project(`
export const definition = {
  apiVersion: 1,
  runsOn: 'browser',
  capabilities: ['webgl'],
  inputs: { seed: { kind: 'data', type: 'float', default: 1 } },
  outputs: { out: { kind: 'data', type: 'texture' } }
} as const;
export async function execute(context) {
  const lease = await context.capabilities.webgl.createTexture({}, { signal: context.signal });
  context.outputs.out.set(lease.value);
}
`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(validateProjectGraph(fixture.file, fixture.document)).resolves.toBeUndefined();
      await expect(checkProjectGraph(fixture.file, fixture.document)).resolves.toBeUndefined();
      expect(warn.mock.calls.flat().join('\n')).toMatch(/one node in this graph targets another host/);
    } finally {
      warn.mockRestore();
    }
  });

  it('sorts an environment mismatch into warnings and everything else into errors', () => {
    const { errors, warnings } = classifyPreflight([
      { phase: 'preflight', code: 'runtime/preflight-environment', message: 'x requires browser' },
      { phase: 'preflight', code: 'runtime/missing-capability', message: 'Missing capability media for x' },
    ]);
    expect(warnings.map((item) => item.code)).toEqual(['runtime/preflight-environment']);
    expect(errors.map((item) => item.code)).toEqual(['runtime/missing-capability']);
  });

  it('inspects definitions without evaluating modules', async () => {
    const fixture = project(validSource);
    const inspection = await inspectProjectGraph(fixture.file, fixture.document);
    expect(inspection).toMatchObject({ deterministic: true, connections: 0 });
    expect(inspection.nodes[0]).toMatchObject({ id: 'multiply', module: 'project.Multiply', classification: 'definition-v1' });
  });
});

/**
 * `--frames` on a definition-v1 graph.
 *
 * It used to refuse: *"--frames renders dynamic graphs; this graph is
 * definition-v1 and runs through the deterministic runtime."* True, and the
 * whole problem — the preferred node style was the one that could not be
 * animated offline. The renders here are decoded, not weighed: five identical
 * file sizes is exactly what a broken clock produces.
 */
describe('rendering a frame sequence from a definition-v1 graph', () => {
  const rampSource = `
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  capabilities: ['assets'],
  inputs: {},
  outputs: { image: { kind: 'data', type: 'image' } },
  props: { phase: { type: 'float', default: 0 } }
} as const;
export async function execute(context) {
  const level = Math.max(0, Math.min(255, Math.round(context.props.phase)));
  const header = 'P6\\n2 2\\n255\\n';
  const pixels = new Uint8Array(2 * 2 * 3).fill(level);
  const bytes = new Uint8Array(header.length + pixels.length);
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  bytes.set(pixels, header.length);
  const asset = await context.capabilities.assets.write(
    bytes,
    { mediaType: 'image/x-portable-pixmap', suggestedName: 'ramp.ppm' },
    { signal: context.signal },
  );
  context.outputs.image.set(asset);
}
`;

  function rampProject(props: Record<string, unknown>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-cli-frames-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'nodes', 'Ramp'), { recursive: true });
    fs.writeFileSync(path.join(root, 'nodes', 'Ramp', 'index.ts'), rampSource);
    const file = path.join(root, 'index.cascade');
    const document = {
      version: '0.2',
      nodes: [{ id: 'ramp', module: 'project.Ramp', props }],
      connections: [],
    };
    fs.writeFileSync(file, JSON.stringify(document));
    return { root, file, document };
  }

  /** The one grey level in each frame, read out of the PPM body. */
  function levels(root: string, out: string): number[] {
    return fs.readdirSync(path.join(root, out)).sort().map((name) => {
      const data = fs.readFileSync(path.join(root, out, name));
      const body = data.subarray(data.indexOf('255\n') + 4);
      return body[0];
    });
  }

  it('walks an expression across the range', async () => {
    const fixture = rampProject({ phase: { value: 0, expression: '$T * 250' } });
    const rendered = await renderDeterministicProjectFrames(fixture.file, fixture.document, {
      start: 1, end: 5, fps: 25, out: 'renders',
    });

    expect(rendered).not.toBeNull();
    expect(rendered!.frames).toEqual([1, 2, 3, 4, 5]);
    expect(rendered!.files).toEqual([
      'renders/ramp.0001.ppm',
      'renders/ramp.0002.ppm',
      'renders/ramp.0003.ppm',
      'renders/ramp.0004.ppm',
      'renders/ramp.0005.ppm',
    ]);
    // $T is (frame - 1) / fps, so 25fps gives 0, 0.04, 0.08 … times 250.
    expect(levels(fixture.root, 'renders')).toEqual([0, 10, 20, 30, 40]);
  }, 30_000);

  it('walks a keyframe channel across the range', async () => {
    const fixture = rampProject({
      phase: {
        value: 0,
        channel: {
          keys: [
            { frame: 1, value: 0, interpolation: 'linear' },
            { frame: 5, value: 200 },
          ],
        },
      },
    });
    const rendered = await renderDeterministicProjectFrames(fixture.file, fixture.document, {
      start: 1, end: 5, fps: 25, out: 'renders',
    });

    expect(levels(fixture.root, 'renders')).toEqual([0, 50, 100, 150, 200]);
  }, 30_000);

  it('leaves a dynamic graph to the other host', async () => {
    const dynamic = project(validSource.replace(/export const definition[\s\S]*?} as const;/, ''));
    await expect(renderDeterministicProjectFrames(dynamic.file, dynamic.document, {
      start: 1, end: 2, out: 'renders',
    })).resolves.toBeNull();
  }, 30_000);
});
