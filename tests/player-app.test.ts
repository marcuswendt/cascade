// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { NodeDefinition } from '../packages/contracts/src/index.js';
import type { DefinitionNodeRegistration } from '../packages/runtime/src/types.js';
import { startPlayer } from '../src/player/app.js';
import { installIoBridge, loadBytes } from '../server/src/runtime/io.js';

const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  inputs: { value: { kind: 'data', type: 'float', default: 2 } },
  outputs: { result: { kind: 'data', type: 'float' } },
  props: { factor: { type: 'float', default: 3 } },
} as const satisfies NodeDefinition;

const registration = {
  kind: 'definition-v1',
  moduleId: 'project.Multiply',
  definition,
  loadExecute: async () => async (context) => {
    context.outputs.result.set(context.inputs.value * context.props.factor);
  },
} satisfies DefinitionNodeRegistration<typeof definition>;

function graph() {
  return {
    version: '0.2',
    nodes: [{ id: 'multiply', module: registration.moduleId }],
    connections: [],
  } as never;
}

describe('startPlayer', () => {
  it('restores IO and shows a diagnostic when runtime construction fails', async () => {
    const restore = installIoBridge({ read: async () => new Uint8Array([7]), write: async path => path });
    const root = document.createElement('main');
    try {
      await expect(startPlayer({ document: graph(), registrations: [registration, registration], assets: {}, root })).rejects.toThrow();
      expect(new Uint8Array(await loadBytes('previous'))).toEqual(new Uint8Array([7]));
      expect((root.querySelector('[role="alert"]') as HTMLElement).hidden).toBe(false);
    } finally { restore(); }
  });
  it('waits for its first cook and exposes cooked mutations through one controller', async () => {
    const root = document.createElement('main');
    const player = await startPlayer({ document: graph(), registrations: [registration], assets: {}, root });

    expect(player.getOutput('multiply', 'result')).toBe(6);
    await player.setInput('multiply', 'value', 5);
    expect(player.getOutput('multiply', 'result')).toBe(15);
    await player.setProp('multiply', 'factor', 4);
    expect(player.getOutput('multiply', 'result')).toBe(20);
    await player.seek(12);
    expect(root.querySelector('[data-cascade-output]')?.textContent).toContain('20');
    expect(await (await player.downloadOutput()).text()).toBe('20');

    await player.dispose();
    await player.dispose();
    expect(root.childElementCount).toBe(0);
  });

  it('serializes explicit frame cooks', async () => {
    let active = 0;
    let maximum = 0;
    let executions = 0;
    const slow = {
      ...registration,
      moduleId: 'project.Slow',
      loadExecute: async () => async (context) => {
        active += 1;
        executions += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        context.outputs.result.set(executions);
        active -= 1;
      },
    } satisfies DefinitionNodeRegistration<typeof definition>;
    const source = graph();
    source.nodes[0].module = slow.moduleId;
    const root = document.createElement('main');
    const player = await startPlayer({ document: source, registrations: [slow], assets: {}, root });

    await Promise.all([player.seek(2), player.seek(3), player.seek(4)]);
    expect(maximum).toBe(1);
    expect(player.getOutput('multiply', 'result')).toBe(4);
    await player.dispose();
  });

  it('reports the effective frame and resumes playback from an explicit seek', async () => {
    const root = document.createElement('main');
    const player = await startPlayer({ document: graph(), registrations: [registration], assets: {}, root });
    const frames: number[] = [];
    player.subscribe(event => { if (event.type === 'frame') frames.push(event.frame); });
    await player.seek(-10);
    expect(frames.at(-1)).toBe(1);
    player.play();
    await player.seek(100);
    /**
     * Waiting on a real playback clock, so the timeout has to be generous.
     *
     * `vi.waitFor`'s default of one second is not enough when vitest is running
     * this file in parallel with everything else — playback advances on a timer,
     * and a timer on a busy machine can miss a second easily. This was one of
     * three tests failing at random in the full suite on 2026-09-10 while
     * passing every time in isolation.
     *
     * Five seconds is not a performance claim. It is the point past which
     * playback is genuinely broken rather than merely descheduled.
     */
    await vi.waitFor(() => expect(frames.at(-1)).toBeGreaterThan(100), {
      timeout: 5000,
      interval: 20,
    });
    expect(Number(root.querySelector('input')!.value)).toBeGreaterThan(100);
    await player.dispose();
  });

  it('does not overlap a seek with a playback cook already in flight', async () => {
    let active = 0;
    let maximum = 0;
    let executions = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const slow = {
      ...registration,
      moduleId: 'project.PlaybackGate',
      loadExecute: async () => async (context) => {
        active += 1;
        executions += 1;
        maximum = Math.max(maximum, active);
        if (executions > 1) await held;
        context.outputs.result.set(executions);
        active -= 1;
      },
    } satisfies DefinitionNodeRegistration<typeof definition>;
    const source = graph();
    source.nodes[0].module = slow.moduleId;
    const player = await startPlayer({ document: source, registrations: [slow], assets: {}, root: document.createElement('main') });

    player.play();
    await vi.waitFor(() => expect(executions).toBe(2), { timeout: 5000, interval: 20 });
    const seeking = player.seek(10);
    player.pause();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(maximum).toBe(1);
    release();
    await seeking;
    await player.dispose();
  });

  it('does not step backwards when the first animation timestamp predates play', async () => {
    let tick: FrameRequestCallback | undefined;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { tick = callback; return 1; });
    const player = await startPlayer({ document: graph(), registrations: [registration], assets: {}, root: document.createElement('main') });
    try {
      await player.seek(20);
      const frames: number[] = [];
      player.subscribe(event => { if (event.type === 'frame') frames.push(event.frame); });
      player.play();
      tick!(0);
      await vi.waitFor(() => expect(frames.length).toBe(1), { timeout: 5000, interval: 20 });
      expect(frames[0]).toBeGreaterThanOrEqual(20);
    } finally { await player.dispose(); raf.mockRestore(); }
  });

  it('renders a visible diagnostic and tears down resources when the first cook fails', async () => {
    const failed = {
      ...registration,
      moduleId: 'project.Failed',
      loadExecute: async () => async () => { throw new Error('deliberate player failure'); },
    } satisfies DefinitionNodeRegistration<typeof definition>;
    const root = document.createElement('main');
    const source = graph();
    source.nodes[0].module = failed.moduleId;

    await expect(startPlayer({ document: source, registrations: [failed], assets: {}, root }))
      .rejects.toThrow('deliberate player failure');
    expect(root.textContent).toContain('deliberate player failure');
  });

  it.each(['asset', 'svg'])('keeps the previous selection and releases a failed %s image', async (kind) => {
    const revokeObjectURL = vi.fn();
    let urlIndex = 0;
    class PlayerUrl extends URL {}
    Object.assign(PlayerUrl, {
      createObjectURL: () => `blob:${++urlIndex === 2 ? 'bad' : 'good'}-${urlIndex}`,
      revokeObjectURL,
    });
    vi.stubGlobal('URL', PlayerUrl);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true,
      value: function(this: HTMLImageElement) {
        return this.src.includes('bad') ? Promise.reject(new Error('bad image')) : Promise.resolve();
      },
    });
    const visualDefinition = { apiVersion: 1, runsOn: 'portable', outputs: {
      bad: { kind: 'data', type: 'any' }, good: { kind: 'data', type: 'any' },
    } } as const satisfies NodeDefinition;
    const visual = { kind: 'definition-v1', moduleId: 'project.Visual', definition: visualDefinition,
      loadExecute: async () => context => {
        context.outputs.bad.set(kind === 'svg' ? '<svg>bad</svg>' : { path: 'bad.png', mediaType: 'image/png' });
        context.outputs.good.set(kind === 'svg' ? '<svg>good</svg>' : { path: 'good.png', mediaType: 'image/png' });
      },
    } satisfies DefinitionNodeRegistration<typeof visualDefinition>;
    const source = graph(); source.nodes[0].module = visual.moduleId;
    const root = document.createElement('main');
    let player;
    try {
      player = await startPlayer({ document: source, registrations: [visual], root,
        assets: { 'bad.png': 'http://localhost/bad.png', 'good.png': 'http://localhost/good.png' } });
      const errors: string[] = [];
      player.subscribe(event => { if (event.type === 'error') errors.push(event.error.message); });
      await expect(player.selectOutput('multiply', 'bad')).rejects.toThrow('bad image');
      expect(root.querySelector('img')!.src).toContain('good');
      if (kind === 'svg') expect(revokeObjectURL.mock.calls).toEqual([['blob:bad-2']]);
      expect(errors).toEqual(['bad image']);
      await expect(player.seek(2)).resolves.toBeUndefined();
    } finally {
      await player?.dispose();
      if (descriptor) Object.defineProperty(HTMLImageElement.prototype, 'decode', descriptor);
      else Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
      vi.unstubAllGlobals();
    }
  });
});
