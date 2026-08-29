# Plan: cook scheduling and visual feedback

A handoff document. Written for an agent who has not seen the session this came
out of, so it states the evidence rather than asking you to take it on trust.

**Goal.** The graph should recompute exactly what a change affects and nothing
else, and it should show you what it is doing while it does it.

---

## What is actually wrong

Three faults, all verified against the code rather than inferred.

### 1. A parameter change does not recompute downstream

`src/editor/Inspector.svelte`, `handleParamChange`:

```ts
node.setParameter(parameter.name, value);
node.execute?.().catch(...);
```

`setParameter` calls `markDirty()`, and `Node.markDownstreamDirty()`
(`src/nodes/Node.ts`) walks the output connections and sets `manualDirty` on
every dependent. That part is correct. **Nothing then executes them.** Only the
node whose parameter changed re-runs; its dependents are marked stale and stay
stale until an unrelated cook happens to sweep through.

This is the substance of "the graph needs to be intelligent about when to
recompute". Everything else here is secondary to it.

### 2. Load cooks by brute force

`src/App.svelte`, `cookGraph()` runs `graph.execute()` up to 16 times and stops
when neither the resolved-output count nor the pending-connection count moves.
On example-project it settles after 8–10 passes over 21 nodes: on the order of
**200 node executions to do 21 nodes of work**.

It exists for a real reason (see *The hard constraint* below) and it is only
tolerable because the Python stage cache makes a repeated stage nearly free. The
cache is hiding the scheduling problem rather than solving it.

### 3. Nothing reports state

`Node.cookInfo` already records `cookCount`, `lastCookTime`, `totalCookTime`,
`averageCookTime` and `lastCookTimestamp`. Nothing reads it. There is no `cooking`, `queued` or
`stale` anywhere in the UI, so a graph mid-cook and a graph doing nothing look
identical — which on a cold open means four seconds that read as a hang.

---

## The hard constraint, which shapes everything else

**A node's ports do not exist until its code has run.** Ports are created by
`node.in()` / `node.out()` / `node.param()` calls inside `execute()`. So on a
cold load the scheduler cannot know the graph's shape in order to sort it: it
has to run nodes to discover the edges, which is precisely why the fixpoint loop
exists.

Do not try to delete the fixpoint and write a scheduler in one step. It will
appear to work on a warm graph and fail on a cold one.

Two stages instead:

- **Now:** keep a bounded fixpoint for the *first* load only. Once it settles,
  the shape is known — hand over to precise dirty-tracking for everything after.
- **Later:** let a node declare its ports statically, so the shape is known
  before anything runs and the fixpoint retires. The convention introduced
  recently — *a node declares its whole shape (parameters, inputs, outputs)
  before any early return* — is half of this already. Every node in example-project
  follows it.

---

## The mechanism

### One state per node

```ts
type CookState = 'clean' | 'stale' | 'queued' | 'cooking' | 'error';
```

On `Node`. This single field is what the scheduler reads and what the UI draws.
Resist adding a second source of truth for the visuals — the reason the viewer
and the node UI have needed repeated fixes is that several things independently
decided what was current.

### One scheduler

A `CookScheduler` owning the whole question of what runs and when. Everything
that currently calls `node.execute()` directly should instead mark stale and let
the scheduler decide.

```
markStale(node)     → node.state = 'stale', propagate stale downstream, schedule
schedule()          → coalesce; run on the next idle tick
run()               → topologically sort the stale set, execute in order
```

Requirements worth stating explicitly, because each one is a way this goes
wrong:

- **Only the stale set runs.** Not the graph. The measure below tests this.
- **Coalesce.** Dragging a slider marks stale on every frame. It should cook
  once when the drag pauses, not forty times. A debounce on `schedule()` is
  enough; do not debounce `markStale`, or the UI cannot show stale immediately.
- **Cancel superseded work.** If a cook is in flight for a value that has since
  changed, its result is worthless. Carry a generation counter and drop results
  from a stale generation rather than letting them land.
- **Errors do not stop the queue.** One failing node marks itself `error` and
  its dependents stay `stale`; unrelated branches still run.

The Python stage cache (`nodes/_shared/node_cli.py` in a project, keyed on args
plus the identity of every input file) stays underneath as the second line. It
is what makes a genuine re-run cheap when inputs did not really change.

---

## The visual language

**Node.** `cooking` gets a pulsing outline. Drive the pulse from one shared
timer or a CSS animation, not a per-node rAF loop — twenty cooking nodes should
not be twenty animation loops. `stale` is dimmed. `error` is red and stays red
until that node next cooks successfully. `clean` looks as it does today.

Note: node colour is applied as `--node-fill` on `.body`, and the selection ring
is a `box-shadow`. Add cook state as a third, separate channel — an inline
`border-color` here will silently defeat the selection ring, which has already
happened once.

**Wire.** An animated dash flowing source → target while the node it feeds is
`cooking` or `queued`. This is the part that conveys direction; without it you
get nodes blinking independently and no sense of work moving through the graph.
Wire geometry is measured from the port dots' real screen positions, so if you
touch that code, re-check it after a layout — the store `editor/stores/graphStructure.ts`
exists for exactly this invalidation and has to be bumped after the browser has
laid out, not merely after a Svelte tick.

**Graph.** A thin status strip: `cooking 7 of 22`, the current node's name,
elapsed. **Loading must be a distinct state from cooking** — on a cold open the
time goes on fetching and compiling node modules before any node runs, and a
graph that looks idle for four seconds reads as broken.

---

## Order of work

1. **The propagation fix and the scheduler.** Smallest and highest value: it
   makes the graph behave correctly. Everything after this is feedback.
2. **`CookState` on `Node`, and the cooking outline.** Feedback follows
   correctness rather than decorating the current behaviour.
3. **Wire animation and the status strip.**
4. **Static port declaration**, retiring the fixpoint.

---

## Acceptance

"Feels faster" is not a measure. Instrument `cookInfo.cookCount` and assert:

- Changing a parameter executes **exactly** the node plus its transitive
  dependents. On example-project, nudging a stipple parameter must not re-run
  segmentation or the depth signal.
- A cold load executes each node a small constant number of times, not ~10×.
- Dragging a slider across its range produces one cook per pause, not one per
  frame.
- With every node clean, doing nothing executes nothing.

Report the before and after numbers. They were roughly 200 executions for 21
nodes on load, and 1 execution (with no downstream) for a parameter change.

---

## Files this touches

| Where | What |
| --- | --- |
| `src/nodes/Node.ts` | `CookState`, `markDownstreamDirty` (exists, correct), `cookInfo` |
| `src/nodes/Graph.ts` | `execute()`, `getTopologicalOrder()`, `executeFromEntry()` |
| `src/App.svelte` | `cookGraph()` — the fixpoint to be replaced |
| `src/editor/Inspector.svelte` | `handleParamChange`, `handlePortChange` — currently call `execute()` directly |
| `src/editor/NodeUI.svelte` | node visuals; mind `--node-fill` and the selection ring |
| `src/editor/Canvas.svelte` | wire rendering; `nodePositions` and its `$graphStructure` dependency |
| `src/editor/stores/graphStructure.ts` | structural invalidation, already used for redraws |

## One caution

Cascade's working tree is currently worked on by more than one agent. Check
`git status` before starting and prefer small, frequent commits over one large
one.
