// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { PortGeometry, measurePorts, annotationPortOffset } from '../../src/editor/portGeometry';

/** Give an element a fixed screen rect. */
function at(el: Element, left: number, top: number, width: number, height: number) {
  (el as HTMLElement).getBoundingClientRect = () => ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON() {} }) as DOMRect;
}

/** A node root at screen (100, 50), zoom 2: one input dot, one variadic pill, one output dot. */
function buildNode() {
  const root = document.createElement('div');
  root.className = 'node';
  root.dataset.nodeId = 'n1';
  root.innerHTML = `
    <div class="port" data-port-id="in_a"><span class="port-dot"></span></div>
    <div class="port variadic" data-port-id="img_0" data-variadic-ports="img_0,img_1,img_2"><span class="port-pill"></span></div>
    <div class="port" data-port-id="out"><span class="port-dot"></span></div>`;
  document.body.appendChild(root);
  at(root, 100, 50, 200, 120);
  const [dotA, pill, dotOut] = root.querySelectorAll('.port-dot, .port-pill');
  at(dotA, 110, 52, 16, 16);      // centre (118, 60)
  at(pill, 150, 54, 160, 12);     // centre (230, 60)
  at(dotOut, 190, 150, 16, 16);   // centre (198, 158)
  return root;
}

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('port geometry', () => {
  it('measures dot centres as zoom-free offsets from the node top-left', () => {
    const { ports, width, height } = measurePorts(buildNode(), 2);
    expect(ports.get('in_a')).toEqual({ dx: 9, dy: 5 });
    expect(ports.get('out')).toEqual({ dx: 49, dy: 54 });
    expect(width).toBe(100);
    expect(height).toBe(60);
  });

  it('maps every port of a variadic group onto its one pill', () => {
    const { ports } = measurePorts(buildNode(), 2);
    for (const id of ['img_0', 'img_1', 'img_2']) expect(ports.get(id)).toEqual({ dx: 65, dy: 5 });
  });

  it('measures once per batch, bumps the revision, and needs no reads afterwards', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const root = buildNode();
    const geometry = new PortGeometry(() => 2);
    geometry.track('n1', root);
    expect(geometry.isCurrent('n1')).toBe(false);
    expect(frames).toHaveLength(1);
    frames.shift()!(0);
    expect(get(geometry.revision)).toBe(1);
    expect(geometry.offset('n1', 'out')).toEqual({ dx: 49, dy: 54 });
    expect(geometry.size('n1')).toEqual({ width: 100, height: 60 });

    // Lookups are pure: no layout read.
    const spy = vi.spyOn(root, 'getBoundingClientRect');
    for (let i = 0; i < 100; i++) geometry.offset('n1', 'in_a');
    expect(spy).not.toHaveBeenCalled();

    // An unchanged re-measure does not bump the revision.
    geometry.invalidate('n1');
    frames.shift()!(0);
    expect(get(geometry.revision)).toBe(1);
    geometry.destroy();
  });

  it('agrees with the DOM within a pixel after the node moves, at any zoom', () => {
    const root = buildNode();
    const geometry = new PortGeometry(() => 2);
    geometry.track('n1', root);
    geometry.flush();
    // The node moved by (30, 40) graph units at zoom 2: everything shifts (60, 80) on screen.
    const node = { x: 0, y: 0 };
    const toScreen = (p: { x: number; y: number }) => ({ x: 100 + p.x * 2, y: 50 + p.y * 2 });
    expect(geometry.verify(() => node, toScreen).worstPx).toBeLessThan(1);
    node.x = 30; node.y = 40;
    for (const el of root.querySelectorAll<HTMLElement>('.port-dot, .port-pill')) {
      const r = el.getBoundingClientRect();
      at(el, r.left + 60, r.top + 80, r.width, r.height);
    }
    const result = geometry.verify(() => node, toScreen);
    expect(result.ports).toBe(3);
    expect(result.worstPx).toBeLessThan(1);
    geometry.destroy();
  });

  it('places annotation ports at their bottom centre, as the templates do', () => {
    expect(annotationPortOffset({ type: 'Text', size: { width: 400, height: 80 } })).toEqual({ dx: 200, dy: 80 });
    expect(annotationPortOffset({ type: 'Text', size: { width: 400, height: 'auto' } })).toEqual({ dx: 200, dy: 60 });
    expect(annotationPortOffset({ type: 'Image', size: null })).toEqual({ dx: 100, dy: 150 });
  });
});
