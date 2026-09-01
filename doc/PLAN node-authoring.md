# Plan: authoring nodes the way Houdini lets you author operators

Written 2026-09-01, from Marcus's list of what he needs in order to experiment rather than only port existing sketches: see node internals, create nodes, move a node from project to library, duplicate a node into a local copy and change it, edit a node's parameters, and drive parameters by expression.

The short version: **one of the six already works and is already Houdini-shaped, three are half-built with dead buttons in the UI, and two are blocked on one architectural decision** — where a per-instance divergence from a node type is allowed to live.

## What Houdini actually does

Worth stating precisely, because the useful part is not the feature list but the three ideas underneath it.

**The library ladder.** An asset definition lives in a library file, and the same asset can sit at three scopes: *embedded* in the scene file, in a *user* library, or in a *shared job* library. `Save As` moves a definition between them, and names are namespaced and versioned (`namespace::name::version`) so a moved or forked copy never silently shadows the original.

**Type versus instance.** Type Properties edits the definition and every instance changes. *Spare parameters* edit one node's interface only, leaving the type alone. *Allow Editing of Contents* unlocks one instance so its internals diverge, and *Match Current Definition* throws that divergence away. The instance-level edits are stored in the scene file, not in the asset.

**Channel references.** `ch("../transform1/tx")` reads another parameter by path; relative paths make a subnetwork portable; Copy Parameter and Paste Relative References make the common case a two-click gesture rather than typed syntax. `$F`, `$T` and friends put time in the same language.

Everything Marcus listed is one of those three ideas.

## Where Cascade stands, item by item

**(f) Expressions — done, and already Houdini's dialect.** `src/engine/expressions/ExpressionEngine.ts` implements `ch`, `chs`, `chv`, `opinput`, `time`, `frame`, plus noise, rand, clamp and padzero, with autocomplete over nodes and props in `src/editor/components/ExpressionInput.svelte`. Props carry `expression` and `expressionError` and re-evaluate on a time dependency.

One problem, and it is a real one: this lives entirely in the compatibility engine (`src/engine`, `src/nodes/Node.ts`), not in `packages/runtime`. A deterministic definition-v1 node has no expression story at all. When Studio moves onto the neutral runtime, expressions come along or they die, and nobody has said which.

**(a) Seeing node internals — mostly there.** The code panel opens per node, badges its source as `stdlib`, `embedded` or `project`, and makes stdlib read-only, which is correct. Two gaps: the `Open in VSCode` button for project nodes has no click handler at all, and there is no way to see a compiled built-in's ports without reading Cascade's own source.

**(b) Creating nodes — there, in two forms.** An embedded `local.*` node is created and edited in Studio and saved into the graph document. A project node is a directory under `nodes/`. Both work.

**(c) Project to library — not built.** `CodeEditor.svelte` has an `Extract to File` button, and (d) has a `Duplicate to local` button. **Neither is wired: `onExtract` and `onDuplicate` are props that no parent ever passes**, so both handlers are `undefined?.()` and the buttons do nothing. Grep for either name outside `CodeEditor.svelte` and there are zero hits. Promotion from a project's `nodes/` to `shared/` is currently done by hand, by moving a directory and adding a re-export — which is how `cloud-plots` and `cloud-posters` came to share four nodes.

**(d) Duplicate into a local copy — not built**, same dead button. Canvas duplication copies node *instances*, not definitions.

**(e) Editing a node's parameters — not built.** There is no parameter-interface editor. Parameters exist only as code: `node.param(...)` in a legacy node, or the `inputs`/`props` literal in a definition-v1 node. The control vocabulary is already rich (`colorramp`, vectors, matrices, folders, groups, ranges), so the missing piece is the editor, not the types.

## The one decision that unblocks (d) and (e)

Definition-v1 is deliberately static: the extractor reads a node module's syntax and never evaluates it, and `execute` may not create ports or props. That is what makes graphs inspectable without running user code, and it is worth keeping.

Houdini's spare parameters and unlocked instances are, on their face, exactly the dynamic behaviour that model forbids. But only on their face. Houdini stores those edits **in the scene file, not in the asset** — and Cascade's equivalent of the scene file is the `.cascade` document, which is authored data the runtime already loads and validates.

So the resolution is: **a per-instance interface change is data in the graph document, never a runtime mutation.** A node element gains an optional `parameters` block that adds or overrides props for that instance alone. The extractor stays pure, `cascade check` can still validate everything statically, and the divergence is visible in the diff instead of hidden in a closure. "Match current definition" becomes deleting that block.

If that is agreed, (d) and (e) are ordinary work. If it is not, they cannot be built at all without giving up static inspection.

## Proposed order

1. **Wire the two dead buttons.** `Duplicate to local` and `Extract to File` already exist in the UI and are the whole of (c) and (d) at the embedded level. Wiring them, plus `Open in VSCode`, is small and removes three lies from the interface.
2. **Promote to shared.** Extend extract with a destination: embedded, `nodes/`, or `shared/nodes/`. Namespace the module ID so a promoted node does not silently shadow a project-local one of the same name, which is the versioning problem Houdini solved with `namespace::name::version`.
3. **Instance parameters in the document**, per the decision above, with the Inspector gaining an add/edit/remove interface and a visible marker that an instance has diverged.
4. **Expressions on the neutral runtime.** Port the expression engine out of `src/engine` into `packages/runtime` so definition-v1 nodes get `ch()` too. Until this happens, every node ported to definition-v1 loses expressions, which makes the migration a downgrade for exactly the authoring Marcus is asking for.
5. **Copy parameter / paste relative reference**, the two-click gesture. Cheap once (4) exists, and it is what makes expressions get used.

Item 4 is the one with a deadline attached to it by other work: the definition-v1 port of `cloud-plots` is queued, and doing it before expressions exist on the new runtime would strand them.

## Prompting a node into life, and editing code without reloading

Added later the same day, from Marcus: he wants to bring a new node into being from a prompt without leaving Cascade, and to change node code without reloading the whole app — with the generation done by a background Claude Code or Codex process rather than by reimplementing an agent against completion APIs.

The good news is that almost none of this is AI work. It is one dead wire and one process spawn.

### Hot reload is two connectors and no cable

`src/engine/nodeModuleLoader.ts` caches each project module's compiled bundle and exports `invalidateProjectModule(folderName)` to drop one. Its own comment says it is "called when the file-watcher reports a project module's file changed". **It has zero callers.** `src/editor/FileWatcher.ts` implements exactly the watcher that comment describes, with polling, debounce and a change-event type — and it is never instantiated anywhere in the application.

So editing `nodes/<Name>/index.ts` on disk does nothing until the app is reloaded, which is the complaint. Both ends of the wire exist; nothing joins them.

The fix, smallest first:

1. The server watches `nodes/` and the canonical target of `shared/` and pushes a change event on the WebSocket the Studio session already holds. Server-side `fs.watch` beats the browser-side polling FileWatcher was written for, and makes that file redundant — delete it rather than wire it.
2. The client calls `invalidateProjectModule(folder)` on the event and marks the nodes using that module dirty, so the next cook recompiles instead of reusing the stale bundle.

That is the whole of "change code without reloading the app", and it also makes every later item work, because everything below writes a file and then wants the graph to notice.

### The agent is a configured command, not a feature

Cascade already has the pieces for running an agent, and they were built for something else:

- `POST /api/nodes` scaffolds `nodes/<name>/index.ts` and auto-commits it.
- The shell capability runs `spawn(executable, args, { shell: false })` against **aliases configured in `cascade.json`**, with bounded input, output and time, dangerous-environment-key rejection, process-tree cancellation, redacted audits, and capability-token routes.
- The project is a git repository, and scaffolding already commits.

So "prompt a node into life" is: scaffold the directory, then run the configured `agent` alias in it with the prompt, then let the watcher above reload the module when the agent writes the file. Claude Code in headless mode (`claude -p`) and Codex both fit that shape, because both are ordinary executables that edit files in a working directory.

What this buys, and the reason it is worth preferring over an SDK integration:

- **No API keys inside Cascade.** The agent already has its own credentials; Cascade never sees them, and the credential system does not have to grow a model provider.
- **No agent to maintain.** Tool use, file editing, retries and context are the agent's problem. Cascade contributes the scaffold and the reload.
- **It is auditable and cancellable already**, through the same policy that governs every other shell alias, rather than through a new code path with its own rules.
- **The output is a file in git**, so a generated node is reviewable and revertable like any other, instead of being a blob in the graph document.

The one real design question is where the conversation lives. A node that was generated once and then edited by hand has diverged from its prompt, and a second prompt against it is a revision, not a regeneration. Houdini has no equivalent to borrow from. The cheapest honest answer is to keep the prompt and the agent's summary as a comment header in the generated file, so the history lives with the code and in git, and to treat every later prompt as an edit to an existing file rather than a new generation.

### Where this sits against the order above

The watcher is step 0 — it is small, it is what makes the app feel alive, and steps 1 to 5 all assume it. The agent command should come after the promote-to-shared work, because a generated node that cannot be promoted out of the project it was born in just moves the copying problem somewhere new.
