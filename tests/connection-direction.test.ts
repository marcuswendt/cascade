/**
 * Wiring in either direction.
 *
 * A user asked for this on 2026-09-10, the day after installing from npm:
 * *"being able to connect 'backwards' (eg. drag from circle divisions pip to an
 * input pip) would also be great, as I find with these kinda things you often
 * expand in both directions as you build out."*
 *
 * A graph edge has a direction and a gesture does not, so the resolver decides
 * which end is the source before any of the connection-building code runs —
 * and that code, which finds free variadic ports, auto-creates an `Input` node
 * inside a subnet and fans several selected nodes into one input, keeps
 * believing what it always believed about direction.
 */
import { describe, expect, it } from 'vitest';

import {
  type ConnectionEndpoint,
  canStartConnection,
  resolveConnection,
} from '../src/editor/connectionDirection';

const out = (nodeId: string, portId = 'geometry'): ConnectionEndpoint => ({
  nodeId,
  portId,
  portType: 'output',
});
const into = (
  nodeId: string,
  portId = 'input',
  variadicBase: string | null = null,
): ConnectionEndpoint => ({ nodeId, portId, portType: 'input', variadicBase });

describe('resolveConnection', () => {
  it('leaves a forward gesture alone', () => {
    const resolved = resolveConnection(out('circle'), into('transform'));
    expect(resolved?.reversed).toBe(false);
    expect(resolved?.source.nodeId).toBe('circle');
    expect(resolved?.target.nodeId).toBe('transform');
  });

  it('swaps a backwards gesture, so the output is the source', () => {
    // The reported case: start on the input pin, end on the output pin.
    const resolved = resolveConnection(into('transform'), out('circle'));
    expect(resolved?.reversed).toBe(true);
    expect(resolved?.source.nodeId).toBe('circle');
    expect(resolved?.source.portType).toBe('output');
    expect(resolved?.target.nodeId).toBe('transform');
    expect(resolved?.target.portType).toBe('input');
  });

  it('carries the variadic base of whichever end became the target', () => {
    // The subtle half. On a forward gesture the base comes off the dropped
    // element; on a reversed one that element is an output and has none, so it
    // has to survive from the drag's start or a variadic input silently
    // connects to the wrong port in the group.
    const forward = resolveConnection(out('a'), into('merge', 'inputs_0', 'inputs'));
    expect(forward?.target.variadicBase).toBe('inputs');

    const backward = resolveConnection(into('merge', 'inputs_0', 'inputs'), out('a'));
    expect(backward?.target.variadicBase).toBe('inputs');
  });

  it('refuses two outputs', () => {
    expect(resolveConnection(out('a'), out('b'))).toBeNull();
  });

  it('refuses two inputs', () => {
    expect(resolveConnection(into('a'), into('b'))).toBeNull();
  });

  it('refuses a node connecting to itself', () => {
    // Not an edge, and a self-loop would be a cycle even if it were.
    expect(resolveConnection(out('a', 'geometry'), into('a', 'input'))).toBeNull();
    expect(resolveConnection(into('a'), out('a'))).toBeNull();
  });

  it('is symmetric: the same pair resolves the same way from either end', () => {
    // The property that makes this worth a module rather than two branches —
    // the drag path and the click path cannot disagree about a gesture.
    const forward = resolveConnection(out('circle'), into('transform'));
    const backward = resolveConnection(into('transform'), out('circle'));
    expect(forward?.source).toEqual(backward?.source);
    expect(forward?.target).toEqual(backward?.target);
  });
});

describe('canStartConnection', () => {
  it('an output always starts one', () => {
    expect(canStartConnection('output', 0)).toBe(true);
    expect(canStartConnection('output', 3)).toBe(true);
  });

  it('an unconnected input starts one — this is the change', () => {
    // It used to do nothing at all: inputs were claimed for the disconnect
    // gesture, which needs an existing wire, so an empty input pin was inert.
    expect(canStartConnection('input', 0)).toBe(true);
  });

  it('a connected input keeps the disconnect gesture', () => {
    // Pulling a wire off is the more useful reading of dragging from a port
    // that has one, and there is no other way to do it.
    expect(canStartConnection('input', 1)).toBe(false);
  });
});
