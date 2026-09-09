/**
 * Every `cascade.core.*` node must be loadable in Studio.
 *
 * Marcus, 2026-09-09: *"log says: Failed to load default graph: Unknown Cascade
 * node type: cascade.core.Time"*.
 *
 * Two causes, and the second is the one worth a permanent test. `geo` and `pop`
 * both call `registerDefinitionNodes`; **`core` never did**, because when that
 * adapter was written every core node was a hand-written class. And
 * `registerNodeClasses` *replaced* a library's map rather than merging it, so
 * even once core did register, whichever of the two sources ran last erased the
 * other.
 *
 * **`cascade.core.Camera` had the same fault from the day it was written.** It
 * exists, it typechecks, it has its own test file, and it could not be loaded
 * in Studio — nothing noticed because no saved graph had used it yet. That is
 * the recurring shape here: a capability present but not reachable, where every
 * other signal reads green.
 *
 * So this test asserts reachability rather than behaviour: for every core
 * registration in the runtime, `getNodeClass` answers. A new core node will
 * fail this the moment it is written and before it reaches a graph.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { coreNodeRegistrations } from '../packages/runtime/src/builtins/core/index.js';
import { registerDefinitionNodes } from '../src/nodes/definition/DefinitionNode';
import { coreNodeClasses } from '../src/nodes/core/classes';
import { getNodeClass, registerNodeClasses } from '../src/utils/nodeTypeUtils';

beforeAll(async () => {
  // The two sources, in the order Studio loads them: the hand-written classes,
  // then the definition-v1 adapter.
  registerNodeClasses('core', coreNodeClasses);
  await import('../src/nodes/core/definitions');
});

describe('every core node resolves to a class', () => {
  it.each(coreNodeRegistrations.map(registration => registration.moduleId))(
    '%s',
    moduleId => {
      expect(getNodeClass(moduleId)).toBeTruthy();
    },
  );

  it('includes the four authored as definitions', () => {
    // Named individually rather than counted: a count passes when one is
    // swapped for another, and these are the ones with no class behind them.
    for (const moduleId of [
      'cascade.core.Camera',
      'cascade.core.Time',
      'cascade.core.Feedback',
      'cascade.core.Previous',
    ])
      expect(getNodeClass(moduleId), moduleId).toBeTruthy();
  });

  it('keeps the hand-written classes rather than replacing them', () => {
    // The merge, from the other side. Registering the definition subset for
    // `core` used to erase Switch, Merge, Subnet and the rest — which is what
    // every saved graph actually resolves to.
    for (const nodeType of Object.keys(coreNodeClasses))
      expect(getNodeClass(`cascade.core.${nodeType}`), nodeType).toBeTruthy();
  });
});

describe('registerNodeClasses merges', () => {
  it('a second registration adds to a library rather than replacing it', () => {
    class First {}
    class Second {}
    registerNodeClasses('testlib', { First: First as never });
    registerNodeClasses('testlib', { Second: Second as never });
    expect(getNodeClass('cascade.testlib.First')).toBe(First);
    expect(getNodeClass('cascade.testlib.Second')).toBe(Second);
  });

  it('a later registration of the same name still wins', () => {
    // Merging must not make an intentional override impossible.
    class Old {}
    class New {}
    registerNodeClasses('overridelib', { Thing: Old as never });
    registerNodeClasses('overridelib', { Thing: New as never });
    expect(getNodeClass('cascade.overridelib.Thing')).toBe(New);
  });
});
