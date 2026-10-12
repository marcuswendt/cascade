/**
 * Editing a `.cascade` document: add and remove nodes, wire and unwire ports,
 * set parameters, and group nodes into subnets.
 *
 * One implementation behind every surface — `cascade node add`, the MCP
 * server's `node_add`, and anything else that edits a graph without Studio —
 * so a command and a tool call cannot disagree about what an edit means.
 *
 * Three rules hold for every operation, because they are what keeps a graph
 * an agent edited readable to the person who opens it afterwards:
 *
 * - **Minimal diffs.** Only the keys an operation is about change. Node ids are
 *   stable, untouched nodes keep their place in the file, a new key goes where
 *   Studio would write it, and a rewired connection is rewritten in place
 *   rather than removed and appended. An edit followed by its inverse leaves
 *   the file byte-identical (tests/graph-edit.test.ts).
 * - **Placed, not piled.** A node the editor creates is positioned next to what
 *   it is wired to and in line with the graph's existing flow (`layout.ts`).
 * - **Subnets stay closed.** A wire never crosses a subnet boundary directly;
 *   moving nodes in or out of a subnet rewires through its `Input` and
 *   `Output` nodes, creating them when needed and removing them when unused.
 *
 * The editor is pure: it edits a parsed document in memory and resolves node
 * definitions through a callback. Reading, validating and writing files is the
 * host's job (`src/cli/graphFile.ts`).
 */

import type { NodeDefinition } from "@cascade/contracts";
import {
  INPUT,
  NODE_KEY_ORDER,
  OUTPUT,
  SUBNET,
  integer,
  moduleOf,
  parentOf,
  portsFromDefinition,
  positionOf,
  readWire,
  sameEndpoint,
  setOrderedKey,
  setPosition,
  subnetPorts,
  typesConnect,
  wireLabel,
  wireStyleOf,
  writeWire,
  type EditableDocument,
  type EditableNode,
  type Endpoint,
  type NodePorts,
  type PortInfo,
  type Wire,
} from "./document.js";
import { flowStep, isOccupied, placeNode, type Point } from "./layout.js";
import { applyParameterChange, parameterSlot, type ParameterChange } from "./parameters.js";

export interface GraphEditorOptions {
  /** The definition of a module id, or `undefined` when it has none (a dynamic or missing module). */
  readonly definitionOf: (moduleId: string) => NodeDefinition | undefined;
}

/** A refused edit. The document is left as it was before the operation began. */
export class GraphEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphEditError";
  }
}

export interface AddNodeInput {
  readonly module: string;
  readonly id?: string;
  /** The subnet to create the node in. Omitted: the top level. */
  readonly parent?: string;
  readonly position?: Point;
  /** Parameter values, as JSON values or (with `fromText`) command-line text. */
  readonly props?: Readonly<Record<string, unknown>>;
  readonly fromText?: boolean;
  readonly comment?: string;
}

export interface NodeSummary {
  readonly id: string;
  readonly module: string;
  readonly parent: string | null;
  readonly position: Point;
}

export class GraphEditor {
  readonly warnings: string[] = [];

  constructor(
    readonly document: EditableDocument,
    private readonly options: GraphEditorOptions,
  ) {
    if (!Array.isArray(document.nodes)) throw new GraphEditError("Graph document must contain a nodes array");
  }

  // -------------------------------------------------------------------------
  // Nodes

  addNode(input: AddNodeInput): { node: NodeSummary } {
    const parent = input.parent ? this.requireContainer(input.parent) : null;
    const id = input.id ?? this.uniqueId(defaultIdFor(input.module));
    assertValidId(id);
    if (this.findNode(id)) throw new GraphEditError(`A node with id "${id}" already exists`);

    const source = sourceFor(input.module);
    const node: EditableNode = { id, module: input.module, position: [0, 0] };
    if (source) node.source = source;
    if (input.comment) node.comment = input.comment;
    if (parent) node.parent = parent.id;
    this.insertNode(node, parent?.id ?? null);

    for (const [name, value] of Object.entries(input.props ?? {})) {
      this.setParameterOn(node, name, { value, fromText: input.fromText === true });
    }
    setPosition(node, input.position ?? this.placeFor(node));
    return { node: this.summary(node) };
  }

  /**
   * Remove a node and every wire touching it. A subnet with children is
   * refused unless `recursive`, because removing a container silently would
   * remove everything in it.
   */
  removeNode(id: string, options: { recursive?: boolean } = {}): { removed: string[]; wires: string[] } {
    const node = this.requireNode(id);
    const descendants = this.descendantsOf(id);
    if (descendants.length && !options.recursive) {
      throw new GraphEditError(`${id} contains ${descendants.length} node${descendants.length === 1 ? "" : "s"}; remove with --recursive, or dissolve it with "subnet dissolve"`);
    }
    const parent = parentOf(node);
    const boundary = parent ? this.boundaryIndex(node) : null;
    if (boundary && parent) {
      return { removed: [id], wires: this.removeBoundary(this.requireNode(parent), boundary.kind, boundary.index) };
    }

    const removed = new Set([id, ...descendants.map((child) => child.id)]);
    const wires = this.wires()
      .filter(({ wire }) => wire && (removed.has(wire.from.node) || removed.has(wire.to.node)))
      .map(({ index, wire }) => ({ index, label: wireLabel(wire!) }));
    this.removeWires(wires.map((wire) => wire.index));
    this.document.nodes = this.document.nodes.filter((candidate) => !removed.has(candidate.id));
    this.forgetInAnnotations(removed);
    if (this.document.editor && JSON.stringify(this.document.editor).includes(JSON.stringify(id))) {
      this.warnings.push(`The editor section still names ${id}; republish or unpublish its parameters`);
    }
    return { removed: [...removed], wires: wires.map((wire) => wire.label) };
  }

  // -------------------------------------------------------------------------
  // Wires

  /**
   * Wire `from` (`node.output`) to `to` (`node.input`). A port name may be
   * left off when the node has exactly one port on that side.
   *
   * The two nodes may be in different subnets: the wire is then routed
   * through the subnets' `Output` and `Input` nodes, which are created (or
   * reused) as needed, so no wire ever crosses a boundary directly.
   *
   * A node wired for the first time is moved next to its new neighbour, so a
   * node created by `node add` and then connected ends up where a person would
   * have put it. Pass `layout: false` to leave positions alone.
   */
  connect(from: string, to: string, options: { layout?: boolean } = {}): { wire: string; replaced?: string; moved?: NodeSummary } {
    const source = this.resolveEndpoint(from, "output");
    const target = this.resolveEndpoint(to, "input");
    const targetNode = this.requireNode(target.endpoint.node);
    if (!typesConnect(source.info, target.info)) {
      throw new GraphEditError(`${from} (${source.info?.type}) cannot feed ${to} (${target.info?.type})`);
    }
    // Across a subnet boundary, the wire goes through the subnet's ports.
    const routed = this.routeAcross(source.endpoint, parentOf(targetNode));
    const sourceNode = this.requireNode(routed.node);

    const wires = this.wires();
    const wire: Wire = { from: routed, to: target.endpoint };
    if (wires.some(({ wire: other }) => other && sameEndpoint(other.from, wire.from) && sameEndpoint(other.to, wire.to))) {
      this.warnings.push(`${wireLabel(wire)} was already connected`);
      return { wire: wireLabel(wire) };
    }
    const sourceWasFree = routed === source.endpoint && !this.isWired(routed.node);
    const targetWasFree = !this.isWired(target.endpoint.node);

    let replaced: string | undefined;
    const existing = target.info?.variadic ? undefined : wires.find(({ wire: other }) => other && sameEndpoint(other.to, wire.to));
    if (existing?.wire) {
      replaced = wireLabel(existing.wire);
      this.document.connections![existing.index] = writeWire(wire, wireStyleOf(this.document));
      this.warnings.push(`${target.endpoint.node}.${target.endpoint.port} was fed by ${existing.wire.from.node}.${existing.wire.from.port}; replaced`);
    } else {
      this.appendWire(wire);
    }

    let moved: NodeSummary | undefined;
    if (options.layout !== false) {
      if (targetWasFree && !sourceWasFree) moved = this.relayout(targetNode);
      else if (sourceWasFree && !targetWasFree) moved = this.relayout(sourceNode);
      else if (sourceWasFree && targetWasFree) moved = this.relayout(targetNode);
    }
    return { wire: wireLabel(wire), ...(replaced ? { replaced } : {}), ...(moved ? { moved } : {}) };
  }

  /**
   * The endpoint on `level`'s canvas that carries `source`: the source itself
   * when it is already there, otherwise a subnet port reached by passing out
   * through `Output` nodes to the common ancestor and in through `Input` nodes
   * to `level`. Existing boundaries carrying the same value are reused.
   */
  private routeAcross(source: Endpoint, level: string | null): Endpoint {
    const start = parentOf(this.requireNode(source.node));
    if (start === level) return source;
    const down = [...this.ancestorsOf(level), ...(level ? [level] : [])];
    const up = [...this.ancestorsOf(start), ...(start ? [start] : [])];
    let common = 0;
    while (common < down.length && common < up.length && down[common] === up[common]) common += 1;

    let current = source;
    const touched = new Map<string, EditableNode[]>();
    for (const subnetId of up.slice(common).reverse()) {
      const subnet = this.requireNode(subnetId);
      const created = touched.get(subnetId) ?? [];
      const { node: output, isNew } = this.outputFor(subnet, current, created);
      if (isNew) this.appendWire({ from: current, to: { node: output.id, port: "input", index: 0 } });
      touched.set(subnetId, created);
      current = this.subnetPort(subnet, "output", output);
    }
    let lastInput: EditableNode | undefined;
    for (const subnetId of down.slice(common)) {
      const subnet = this.requireNode(subnetId);
      const created = touched.get(subnetId) ?? [];
      const existing = this.inputCarrying(subnet, current, new Set());
      lastInput = existing ?? this.createBoundary(subnet, "input", current, created);
      if (!existing) this.appendWire({ from: current, to: this.subnetPort(subnet, "input", lastInput) });
      touched.set(subnetId, created);
      current = { node: lastInput.id, port: "output", index: 0 };
    }
    for (const [subnetId, created] of touched) {
      this.nameBoundaries(this.requireNode(subnetId), created);
      for (const node of created) setPosition(node, this.placeFor(node));
    }
    // Naming may have given the last Input a better id; the object is the same.
    if (lastInput) current = { node: lastInput.id, port: "output", index: 0 };
    return current;
  }

  /**
   * Remove wires. `disconnect a.out b.in` removes that wire; `disconnect b.in`
   * removes whatever feeds that input; `disconnect a.out` removes everything
   * that output feeds.
   */
  disconnect(first: string, second?: string): { removed: string[] } {
    let matches: (wire: Wire) => boolean;
    if (second !== undefined) {
      const source = this.resolveEndpoint(first, "output").endpoint;
      const target = this.resolveEndpoint(second, "input").endpoint;
      matches = (wire) => sameEndpoint(wire.from, source) && sameEndpoint(wire.to, target);
    } else {
      const { node, port } = splitEndpoint(first);
      this.requireNode(node);
      matches = (wire) => (wire.to.node === node && (!port || wire.to.port === port)) ||
        (wire.from.node === node && (!port || wire.from.port === port) && !!port);
    }
    const found = this.wires().filter(({ wire }) => wire && matches(wire));
    if (!found.length) throw new GraphEditError(`No wire matches ${second === undefined ? first : `${first} -> ${second}`}`);
    this.removeWires(found.map(({ index }) => index));
    return { removed: found.map(({ wire }) => wireLabel(wire!)) };
  }

  // -------------------------------------------------------------------------
  // Parameters

  /** Change `node.param`: its value, expression or keyframes. */
  setParameter(target: string, change: ParameterChange): { node: string; param: string; field: string; before: unknown; after: unknown } {
    const { node: id, port: name } = splitEndpoint(target);
    if (!name) throw new GraphEditError(`Name a parameter: ${target}.<param>`);
    const node = this.requireNode(id);
    const result = this.setParameterOn(node, name, change);
    if (result.field === "inputs" && this.wires().some(({ wire }) => wire && wire.to.node === id && wire.to.port === name)) {
      this.warnings.push(`${id}.${name} is wired; the stored value is used only when the wire is removed`);
    }
    // `null` rather than `undefined`, so "nothing stored, the default applies" survives JSON.
    return { node: id, param: name, field: result.field, before: result.before ?? null, after: result.after ?? null };
  }

  // -------------------------------------------------------------------------
  // Subnets

  /**
   * Group sibling nodes into a new subnet. Wires that now cross its boundary
   * are routed through new `Input` and `Output` nodes, named after the port
   * they carry, so the subnet's ports read as what flows through them.
   */
  createSubnet(input: { nodes: readonly string[]; id?: string; label?: string }): { subnet: NodeSummary; inputs: string[]; outputs: string[] } {
    const members = this.requireSiblings(input.nodes);
    const parent = parentOf(members[0]!);
    const id = input.id ?? this.uniqueId(input.label ? slug(input.label) : "subnet");
    assertValidId(id);
    if (this.findNode(id)) throw new GraphEditError(`A node with id "${id}" already exists`);

    // The subnet takes the place of the first member in the flow, so the
    // parent canvas reads the same with the group closed as it did open.
    const step = this.stepIn(parent);
    const first = members.reduce((best, node) => (along(positionOf(node), step) < along(positionOf(best), step) ? node : best));
    const subnet: EditableNode = { id, module: SUBNET, position: [0, 0], source: "stdlib" };
    if (input.label) subnet.comment = input.label;
    if (parent) subnet.parent = parent;
    setPosition(subnet, positionOf(first));
    const at = Math.min(...members.map((node) => this.document.nodes.indexOf(node)));
    this.document.nodes.splice(at, 0, subnet);

    const created = this.moveIn(new Set(members.map((node) => node.id)), subnet);
    return {
      subnet: this.summary(subnet),
      inputs: created.filter((node) => moduleOf(node) === INPUT).map((node) => node.id),
      outputs: created.filter((node) => moduleOf(node) === OUTPUT).map((node) => node.id),
    };
  }

  /** The inverse of `createSubnet`: lift the children out and remove the subnet. */
  dissolveSubnet(id: string): { lifted: string[] } {
    const subnet = this.requireNode(id);
    if (moduleOf(subnet) !== SUBNET) throw new GraphEditError(`${id} is not a subnet`);
    const members = this.childrenOf(id).filter((node) => !isBoundary(node));
    if (members.length) this.moveOut(new Set(members.map((node) => node.id)), subnet);
    for (const leftover of this.childrenOf(id)) {
      this.warnings.push(`${leftover.id} carried nothing after the dissolve and was removed`);
    }
    this.removeNode(id, { recursive: true });
    return { lifted: members.map((node) => node.id) };
  }

  /**
   * Move sibling nodes to another subnet (`null` for the top level), one level
   * at a time — out to the common ancestor, then in — rewiring through each
   * boundary on the way.
   */
  moveNodes(ids: readonly string[], to: string | null): { moved: string[]; to: string | null; placed: NodeSummary[] } {
    const members = this.requireSiblings(ids);
    const target = to ? this.requireNode(to) : null;
    if (target && moduleOf(target) !== SUBNET) throw new GraphEditError(`${to} is not a subnet`);
    const memberIds = new Set(members.map((node) => node.id));
    if (target && (memberIds.has(target.id) || this.ancestorsOf(target.id).some((id) => memberIds.has(id)))) {
      throw new GraphEditError(`Cannot move ${target.id} into itself`);
    }
    const destination = target?.id ?? null;
    const targetPath = [...this.ancestorsOf(destination), ...(destination ? [destination] : [])];
    let current = parentOf(members[0]!);
    while (current !== null && !targetPath.includes(current)) {
      const container = this.requireNode(current);
      this.moveOut(memberIds, container);
      current = parentOf(container);
    }
    while (current !== destination) {
      // `indexOf(null)` is -1, so from the top level this is the first step down.
      const next = targetPath[targetPath.indexOf(current as string) + 1]!;
      this.moveIn(memberIds, this.requireNode(next));
      current = next;
    }

    // Keep each moved node where it was unless it now sits on top of another.
    const placed: NodeSummary[] = [];
    for (const node of members) {
      const others = this.childrenOf(destination).filter((other) => !memberIds.has(other.id)).map(positionOf);
      const moved = isOccupied(others, positionOf(node)) ? this.relayout(node) : undefined;
      if (moved) placed.push(moved);
    }
    return { moved: [...memberIds], to: destination, placed };
  }

  // -------------------------------------------------------------------------
  // Internals: boundary rewiring

  /**
   * Move sibling nodes from the subnet's parent into the subnet.
   *
   * A wire from a member to the subnet's own input collapses (the member is
   * now inside, so it feeds that input's consumers directly), and a wire from
   * outside to a member is routed through an `Input` — reusing one that
   * already carries the same source. The mirror holds for outputs. Wires are
   * rewritten in place where possible, which is what lets `moveOut` restore
   * the original file exactly.
   */
  private moveIn(members: ReadonlySet<string>, subnet: EditableNode): EditableNode[] {
    for (const id of members) setOrderedKey(this.requireNode(id), "parent", subnet.id, NODE_KEY_ORDER);
    const created: EditableNode[] = [];
    const removed = new Set<number>();
    const total = this.connections().length;
    for (let index = 0; index < total; index += 1) {
      const wire = readWire(this.connections()[index]);
      if (!wire || removed.has(index)) continue;
      const fromMember = members.has(wire.from.node);
      const toMember = members.has(wire.to.node);
      if (fromMember === toMember) continue;

      if (fromMember && wire.to.node === subnet.id) {
        // member -> subnet.input_k: feed that input's consumers directly.
        const k = portNumber(wire.to.port);
        const boundary = this.boundaryNode(subnet, "input", k);
        if (boundary) {
          for (const consumer of this.wires().filter(({ wire: w }) => w?.from.node === boundary.id)) {
            this.replaceWire(consumer.index, { from: wire.from, to: consumer.wire!.to });
          }
        }
        removed.add(index);
        this.removeBoundaryNode(subnet, "input", k, removed);
      } else if (fromMember) {
        // member -> outside: out through an Output.
        const { node: output, isNew } = this.outputFor(subnet, wire.from, created);
        this.replaceWire(index, { from: this.subnetPort(subnet, "output", output), to: wire.to });
        if (isNew) this.appendWire({ from: wire.from, to: { node: output.id, port: "input", index: 0 } });
      } else if (wire.from.node === subnet.id) {
        // subnet.output_k -> member: the member reads the Output's source directly.
        const k = portNumber(wire.from.port);
        const boundary = this.boundaryNode(subnet, "output", k);
        const feed = boundary && this.wires().find(({ wire: w }) => w?.to.node === boundary.id);
        if (feed?.wire) this.replaceWire(index, { from: feed.wire.from, to: wire.to });
        else removed.add(index);
        const stillUsed = this.wires().some(({ index: i, wire: w }) => !removed.has(i) && w?.from.node === subnet.id && w.from.port === wire.from.port && i !== index);
        if (!stillUsed && boundary) {
          if (feed) removed.add(feed.index);
          this.removeBoundaryNode(subnet, "output", k, removed);
        }
      } else {
        // outside -> member: in through an Input.
        const existing = this.inputCarrying(subnet, wire.from, removed);
        if (existing) {
          removed.add(index);
          this.appendWire({ from: { node: existing.id, port: "output", index: 0 }, to: wire.to });
        } else {
          const input = this.createBoundary(subnet, "input", wire.from, created);
          this.replaceWire(index, { from: wire.from, to: this.subnetPort(subnet, "input", input) });
          this.appendWire({ from: { node: input.id, port: "output", index: 0 }, to: wire.to });
        }
      }
    }
    this.removeWires([...removed]);
    this.nameBoundaries(subnet, created);
    for (const node of created) setPosition(node, this.placeFor(node));
    return created;
  }

  /** Move nodes out of a subnet into its parent. The mirror of `moveIn`. */
  private moveOut(members: ReadonlySet<string>, subnet: EditableNode): EditableNode[] {
    const created: EditableNode[] = [];
    const removed = new Set<number>();
    const total = this.connections().length;
    for (let index = 0; index < total; index += 1) {
      const wire = readWire(this.connections()[index]);
      if (!wire || removed.has(index)) continue;
      const fromMember = members.has(wire.from.node);
      const toMember = members.has(wire.to.node);
      if (fromMember === toMember) continue;
      const other = this.findNode(fromMember ? wire.to.node : wire.from.node);

      if (fromMember && other && moduleOf(other) === OUTPUT && parentOf(other) === subnet.id) {
        // member -> Output_k: whatever read subnet.output_k reads the member.
        const k = integer(other.props?.outputIndex);
        for (const consumer of this.wires().filter(({ wire: w }) => w?.from.node === subnet.id && w.from.port === `output_${k}`)) {
          this.replaceWire(consumer.index, { from: wire.from, to: consumer.wire!.to });
        }
        removed.add(index);
        this.removeBoundaryNode(subnet, "output", k, removed);
      } else if (fromMember) {
        // member -> a node staying inside: in through an Input.
        const existing = this.inputCarrying(subnet, wire.from, removed);
        const input = existing ?? this.createBoundary(subnet, "input", wire.from, created);
        this.replaceWire(index, { from: { node: input.id, port: "output", index: 0 }, to: wire.to });
        if (!existing) this.appendWire({ from: wire.from, to: this.subnetPort(subnet, "input", input) });
      } else if (other && moduleOf(other) === INPUT && parentOf(other) === subnet.id) {
        // Input_k -> member: the member reads what feeds subnet.input_k.
        const k = integer(other.props?.inputIndex);
        const feed = this.wires().find(({ index: i, wire: w }) => !removed.has(i) && w?.to.node === subnet.id && w.to.port === `input_${k}`);
        const otherConsumers = this.wires().some(({ index: i, wire: w }) => i !== index && !removed.has(i) && w?.from.node === other.id);
        if (!feed?.wire) {
          removed.add(index);
          this.warnings.push(`${wire.to.node}.${wire.to.port} was fed by an unwired subnet input; it is now unwired`);
        } else if (!otherConsumers) {
          this.replaceWire(feed.index, { from: feed.wire.from, to: wire.to });
          removed.add(index);
        } else {
          this.replaceWire(index, { from: feed.wire.from, to: wire.to });
        }
        if (!otherConsumers) this.removeBoundaryNode(subnet, "input", k, removed);
      } else {
        // a node staying inside -> member: out through an Output.
        const { node: output, isNew } = this.outputFor(subnet, wire.from, created);
        this.replaceWire(index, { from: this.subnetPort(subnet, "output", output), to: wire.to });
        if (isNew) this.appendWire({ from: wire.from, to: { node: output.id, port: "input", index: 0 } });
      }
    }
    this.removeWires([...removed]);
    const parent = parentOf(subnet);
    for (const id of members) {
      const node = this.requireNode(id);
      if (parent) setOrderedKey(node, "parent", parent, NODE_KEY_ORDER);
      else delete node.parent;
    }
    this.nameBoundaries(subnet, created);
    for (const node of created) setPosition(node, this.placeFor(node));
    return created;
  }

  /** An `Output` in the subnet already fed by `source`, or a new one. */
  private outputFor(subnet: EditableNode, source: Endpoint, created: EditableNode[]): { node: EditableNode; isNew: boolean } {
    const existing = this.childrenOf(subnet.id).find((node) =>
      moduleOf(node) === OUTPUT &&
      this.wires().some(({ wire }) => wire?.to.node === node.id && sameEndpoint(wire.from, source)));
    return existing ? { node: existing, isNew: false } : { node: this.createBoundary(subnet, "output", source, created), isNew: true };
  }

  /** An `Input` in the subnet whose outside feed is `source`. */
  private inputCarrying(subnet: EditableNode, source: Endpoint, removed: ReadonlySet<number>): EditableNode | undefined {
    const feed = this.wires().find(({ index, wire }) =>
      !removed.has(index) && wire?.to.node === subnet.id && sameEndpoint(wire.from, source));
    return feed ? this.boundaryNode(subnet, "input", portNumber(feed.wire!.to.port)) : undefined;
  }

  private createBoundary(subnet: EditableNode, kind: "input" | "output", carries: Endpoint, created: EditableNode[]): EditableNode {
    const ports = subnetPorts(this.childrenOf(subnet.id));
    const index = (kind === "input" ? ports.inputs : ports.outputs).length;
    const label = this.labelOf(carries);
    const type = this.portInfo(carries.node, carries.port, "output")?.type ?? "any";
    const id = this.uniqueId(`${subnet.id}-${kind === "input" ? "in" : "out"}-${slug(label)}`);
    const node: EditableNode = {
      id,
      module: kind === "input" ? INPUT : OUTPUT,
      position: [0, 0],
      source: "stdlib",
      comment: label,
      parent: subnet.id,
      props: kind === "input"
        // The name stays empty and the label lives in `comment`, as in every
        // hand-built subnet: Studio names a subnet port after a non-empty
        // name while the runtime always uses `input_<n>`, so a name would make
        // the two hosts disagree about the port and drop the wire in Studio.
        ? { inputIndex: index, inputName: "", dataType: type }
        : { outputIndex: index, outputName: "", dataType: type },
    };
    this.insertNode(node, subnet.id);
    created.push(node);
    return node;
  }

  /**
   * Name new boundary nodes after what they carry, readably. A port name is
   * the natural label (`moment`, `canvas`), but not when it says nothing
   * (`value`, `output`) or when two ports of the subnet would share it — three
   * `mask` outputs read as one. Then the producing node's id is the label:
   * `masks-out-cloud-mask` beside `masks-out-primary-lobe`.
   */
  private nameBoundaries(subnet: EditableNode, created: readonly EditableNode[]): void {
    const carried = (node: EditableNode): Endpoint | undefined => {
      const wire = moduleOf(node) === INPUT
        ? this.wires().find(({ wire: w }) => w?.to.node === subnet.id && w.to.port === `input_${integer(node.props?.inputIndex)}`)?.wire
        : this.wires().find(({ wire: w }) => w?.to.node === node.id)?.wire;
      return wire?.from;
    };
    // Decided for all of them first, so renaming one cannot make its twin look unique.
    const relabel = created.flatMap((node) => {
      const label = String(node.comment ?? "");
      const sameSide = this.childrenOf(subnet.id).filter((other) => moduleOf(other) === moduleOf(node));
      const shared = sameSide.filter((other) => other.comment === label).length > 1;
      const source = carried(node);
      return source && (shared || GENERIC_PORTS.has(label)) ? [{ node, label: source.node }] : [];
    });
    for (const { node, label } of relabel) this.relabelBoundary(subnet, node, label);
  }

  private relabelBoundary(subnet: EditableNode, node: EditableNode, label: string): void {
    const kind = moduleOf(node) === INPUT ? "in" : "out";
    const id = this.uniqueId(`${subnet.id}-${kind}-${slug(label)}`);
    const previous = node.id;
    node.id = id;
    node.comment = label;
    for (const { index, wire } of this.wires()) {
      if (!wire || (wire.from.node !== previous && wire.to.node !== previous)) continue;
      const rename = (end: Endpoint): Endpoint => (end.node === previous ? { ...end, node: id } : end);
      this.replaceWire(index, { from: rename(wire.from), to: rename(wire.to) });
    }
  }

  /** What a value is called: its port name, or for a subnet's own port, the name of the boundary behind it. */
  private labelOf(endpoint: Endpoint): string {
    const node = this.findNode(endpoint.node);
    const port = /^(input|output)_(\d+)$/.exec(endpoint.port);
    if (node && moduleOf(node) === SUBNET && port) {
      const boundary = this.boundaryNode(node, port[1] as "input" | "output", Number(port[2]));
      const name = boundary?.comment || boundary?.props?.[port[1] === "input" ? "inputName" : "outputName"];
      if (typeof name === "string" && name) return name;
    }
    return endpoint.port || endpoint.node;
  }

  /**
   * Remove boundary node k and keep the subnet's ports contiguous: the ports
   * above it shift down one, and so do the wires that use them. Wires to the
   * removed port itself are marked in `removed` for the caller to drop.
   */
  private removeBoundaryNode(subnet: EditableNode, kind: "input" | "output", k: number, removed: Set<number>): void {
    const node = this.boundaryNode(subnet, kind, k);
    if (!node) return;
    const indexProp = kind === "input" ? "inputIndex" : "outputIndex";
    const port = `${kind}_${k}`;
    for (const { index, wire } of this.wires()) {
      if (!wire) continue;
      const touchesPort = kind === "input"
        ? wire.to.node === subnet.id && wire.to.port === port
        : wire.from.node === subnet.id && wire.from.port === port;
      if (touchesPort || wire.from.node === node.id || wire.to.node === node.id) removed.add(index);
    }
    this.document.nodes.splice(this.document.nodes.indexOf(node), 1);
    for (const sibling of this.childrenOf(subnet.id)) {
      if (moduleOf(sibling) !== (kind === "input" ? INPUT : OUTPUT)) continue;
      const index = integer(sibling.props?.[indexProp]);
      if (index > k) sibling.props![indexProp] = index - 1;
    }
    for (const { index, wire } of this.wires()) {
      if (!wire || removed.has(index)) continue;
      const end = kind === "input" ? wire.to : wire.from;
      if (end.node !== subnet.id) continue;
      const n = portNumber(end.port);
      if (n <= k) continue;
      const shifted: Endpoint = { node: subnet.id, port: `${kind}_${n - 1}`, index: n - 1 };
      this.replaceWire(index, kind === "input" ? { from: wire.from, to: shifted } : { from: shifted, to: wire.to });
    }
  }

  /** `rm` of a boundary node: the subnet loses that port. */
  private removeBoundary(subnet: EditableNode, kind: "input" | "output", k: number): string[] {
    const removed = new Set<number>();
    const before = this.wires();
    this.removeBoundaryNode(subnet, kind, k, removed);
    const labels = before.filter(({ index }) => removed.has(index)).map(({ wire }) => wireLabel(wire!));
    this.removeWires([...removed]);
    this.warnings.push(`${subnet.id} lost its ${kind}_${k} port; higher ports were renumbered`);
    return labels;
  }

  private boundaryIndex(node: EditableNode): { kind: "input" | "output"; index: number } | null {
    if (moduleOf(node) === INPUT) return { kind: "input", index: integer(node.props?.inputIndex) };
    if (moduleOf(node) === OUTPUT) return { kind: "output", index: integer(node.props?.outputIndex) };
    return null;
  }

  private boundaryNode(subnet: EditableNode, kind: "input" | "output", k: number): EditableNode | undefined {
    const module = kind === "input" ? INPUT : OUTPUT;
    const indexProp = kind === "input" ? "inputIndex" : "outputIndex";
    return this.childrenOf(subnet.id).find((node) => moduleOf(node) === module && integer(node.props?.[indexProp]) === k);
  }

  private subnetPort(subnet: EditableNode, kind: "input" | "output", boundary: EditableNode): Endpoint {
    const k = integer(boundary.props?.[kind === "input" ? "inputIndex" : "outputIndex"]);
    return { node: subnet.id, port: `${kind}_${k}`, index: k };
  }

  // -------------------------------------------------------------------------
  // Internals: lookup

  findNode(id: string): EditableNode | undefined {
    return this.document.nodes.find((node) => node.id === id);
  }

  requireNode(id: string): EditableNode {
    const node = this.findNode(id);
    if (node) return node;
    const near = this.document.nodes.map((candidate) => candidate.id).filter((candidate) => candidate.includes(id) || id.includes(candidate)).slice(0, 5);
    throw new GraphEditError(`No node "${id}"${near.length ? `; did you mean ${near.join(", ")}?` : ""}`);
  }

  childrenOf(parent: string | null): EditableNode[] {
    return this.document.nodes.filter((node) => parentOf(node) === parent);
  }

  private descendantsOf(id: string): EditableNode[] {
    const result: EditableNode[] = [];
    const queue = [id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const child of this.childrenOf(current)) {
        result.push(child);
        queue.push(child.id);
      }
    }
    return result;
  }

  private ancestorsOf(id: string | null): string[] {
    const chain: string[] = [];
    let current = id ? parentOf(this.requireNode(id)) : null;
    while (current) {
      chain.unshift(current);
      current = parentOf(this.requireNode(current));
    }
    return chain;
  }

  private requireContainer(id: string): EditableNode {
    const node = this.requireNode(id);
    const definition = this.options.definitionOf(moduleOf(node));
    if (moduleOf(node) !== SUBNET && !definition?.container) throw new GraphEditError(`${id} is not a subnet`);
    return node;
  }

  private requireSiblings(ids: readonly string[]): EditableNode[] {
    if (!ids.length) throw new GraphEditError("Name at least one node");
    const nodes = [...new Set(ids)].map((id) => this.requireNode(id));
    const parent = parentOf(nodes[0]!);
    const stray = nodes.find((node) => parentOf(node) !== parent);
    if (stray) throw new GraphEditError(`${stray.id} is not in the same subnet as ${nodes[0]!.id}; move nodes from one subnet at a time`);
    const boundary = nodes.find(isBoundary);
    if (boundary && parent) throw new GraphEditError(`${boundary.id} is ${parent}'s ${moduleOf(boundary) === INPUT ? "input" : "output"}; it stays with its subnet`);
    return nodes;
  }

  /** The ports a node has, or `null` when they are not statically known. */
  portsOf(node: EditableNode): NodePorts | null {
    if (moduleOf(node) === SUBNET) return subnetPorts(this.childrenOf(node.id));
    const definition = this.options.definitionOf(moduleOf(node));
    return definition ? portsFromDefinition(definition) : null;
  }

  private portInfo(nodeId: string, port: string, side: "input" | "output"): PortInfo | undefined {
    const node = this.findNode(nodeId);
    const ports = node && this.portsOf(node);
    return ports ? (side === "input" ? ports.inputs : ports.outputs).find((info) => info.name === port) : undefined;
  }

  /** `node.port` to a checked endpoint. A missing port name is filled in when only one would fit. */
  private resolveEndpoint(text: string, side: "input" | "output"): { endpoint: Endpoint; info?: PortInfo } {
    const { node: id, port } = splitEndpoint(text);
    const node = this.requireNode(id);
    const ports = this.portsOf(node);
    if (!ports) {
      if (!port) throw new GraphEditError(`${id} declares no static ports; name one: ${id}.<${side}>`);
      this.warnings.push(`${id} (${moduleOf(node)}) has no static definition; ${port} is not checked`);
      return { endpoint: { node: id, port, index: this.indexFromExistingWires(id, port, side) } };
    }
    const list = side === "input" ? ports.inputs : ports.outputs;
    const info = port ? list.find((candidate) => candidate.name === port) : list.length === 1 ? list[0] : undefined;
    if (!info) {
      const names = list.map((candidate) => candidate.name).join(", ") || "none";
      throw new GraphEditError(port
        ? `${id} has no ${side} "${port}"; ${side}s: ${names}`
        : `${id} has several ${side}s; name one: ${names}`);
    }
    return { endpoint: { node: id, port: info.name, index: info.index }, info };
  }

  private indexFromExistingWires(node: string, port: string, side: "input" | "output"): number {
    for (const { wire } of this.wires()) {
      const end = wire && (side === "input" ? wire.to : wire.from);
      if (end && end.node === node && end.port === port) return end.index;
    }
    return 0;
  }

  private isWired(id: string): boolean {
    return this.wires().some(({ wire }) => wire && (wire.from.node === id || wire.to.node === id));
  }

  private setParameterOn(node: EditableNode, name: string, change: ParameterChange) {
    const slot = parameterSlot(this.options.definitionOf(moduleOf(node)), name);
    if ("error" in slot) throw new GraphEditError(`${node.id} ${slot.error}`);
    if (!this.options.definitionOf(moduleOf(node))) {
      this.warnings.push(`${node.id} (${moduleOf(node)}) has no static definition; ${name} is stored as a prop unchecked`);
    }
    try {
      return { field: slot.field, ...applyParameterChange(node, name, slot, change) };
    } catch (error) {
      throw new GraphEditError(error instanceof Error ? error.message : String(error));
    }
  }

  // -------------------------------------------------------------------------
  // Internals: the connections array

  private connections(): unknown[] {
    return (this.document.connections ??= []);
  }

  /** Every connection with its array index; unreadable ones have `wire: null` and are left alone. */
  private wires(): { index: number; wire: Wire | null }[] {
    return this.connections().map((raw, index) => ({ index, wire: readWire(raw) }));
  }

  private appendWire(wire: Wire): void {
    const style = wireStyleOf(this.document);
    if (!this.document.connections) setOrderedKey(this.document, "connections", [], ["version", "metadata", "annotations", "nodes", "connections", "editor"]);
    this.connections().push(writeWire(wire, style));
  }

  private replaceWire(index: number, wire: Wire): void {
    this.connections()[index] = writeWire(wire, wireStyleOf(this.document));
  }

  private removeWires(indices: readonly number[]): void {
    const drop = new Set(indices);
    if (!drop.size) return;
    this.document.connections = this.connections().filter((_, index) => !drop.has(index));
    if (!this.document.connections.length) delete this.document.connections;
  }

  // -------------------------------------------------------------------------
  // Internals: placement and housekeeping

  /** Insert after the last node of the same subnet, so a subnet's children stay together in the file. */
  private insertNode(node: EditableNode, parent: string | null): void {
    if (parent === null) {
      this.document.nodes.push(node);
      return;
    }
    const family = new Set([parent, ...this.descendantsOf(parent).map((child) => child.id)]);
    let at = -1;
    this.document.nodes.forEach((candidate, index) => {
      if (family.has(candidate.id)) at = index;
    });
    this.document.nodes.splice(at + 1, 0, node);
  }

  private placeFor(node: EditableNode): Point {
    const parent = parentOf(node);
    const siblings = this.childrenOf(parent).filter((other) => other.id !== node.id);
    const upstream: Point[] = [];
    const downstream: Point[] = [];
    for (const { wire } of this.wires()) {
      if (!wire) continue;
      if (wire.to.node === node.id && wire.from.node !== node.id) {
        const source = this.findNode(wire.from.node);
        if (source && parentOf(source) === parent) upstream.push(positionOf(source));
      }
      if (wire.from.node === node.id && wire.to.node !== node.id) {
        const target = this.findNode(wire.to.node);
        if (target && parentOf(target) === parent) downstream.push(positionOf(target));
      }
    }
    return placeNode({ siblings: siblings.map(positionOf), upstream, downstream, step: this.stepIn(parent, node.id) });
  }

  private relayout(node: EditableNode): NodeSummary | undefined {
    const before = positionOf(node);
    const after = this.placeFor(node);
    if (before.x === after.x && before.y === after.y) return undefined;
    setPosition(node, after);
    return this.summary(node);
  }

  /** The flow of one canvas: the median offset along its wires. */
  private stepIn(parent: string | null, exclude?: string): Point {
    const wires: { from: Point; to: Point }[] = [];
    for (const { wire } of this.wires()) {
      // The node being placed does not get a say in the flow it is placed by.
      if (!wire || wire.from.node === exclude || wire.to.node === exclude) continue;
      const source = this.findNode(wire.from.node);
      const target = this.findNode(wire.to.node);
      if (!source || !target || parentOf(source) !== parent || parentOf(target) !== parent) continue;
      wires.push({ from: positionOf(source), to: positionOf(target) });
    }
    return flowStep(wires);
  }

  private forgetInAnnotations(removed: ReadonlySet<string>): void {
    const annotations = this.document.annotations;
    if (!Array.isArray(annotations)) return;
    this.document.annotations = annotations.filter((annotation) => !removed.has(String(annotation.parent ?? "")));
    for (const annotation of this.document.annotations) {
      if (Array.isArray(annotation.containedElements)) {
        annotation.containedElements = annotation.containedElements.filter((id) => !removed.has(String(id)));
      }
    }
    if (!this.document.annotations.length && annotations.length) delete this.document.annotations;
  }

  uniqueId(base: string): string {
    if (!this.findNode(base)) return base;
    for (let n = 2; ; n += 1) if (!this.findNode(`${base}-${n}`)) return `${base}-${n}`;
  }

  summary(node: EditableNode): NodeSummary {
    return { id: node.id, module: moduleOf(node), parent: parentOf(node), position: positionOf(node) };
  }
}

// ---------------------------------------------------------------------------

/** `a.b.port` splits at the last dot: node `a.b`, port `port`. No dot: the node alone. */
export function splitEndpoint(text: string): { node: string; port: string } {
  const at = text.lastIndexOf(".");
  return at === -1 ? { node: text, port: "" } : { node: text.slice(0, at), port: text.slice(at + 1) };
}

/** `project.InkVocabulary` becomes `ink-vocabulary`; `cascade.geo.CopyToPoints`, `copy-to-points`. */
export function defaultIdFor(module: string): string {
  return slug(module.slice(module.lastIndexOf(".") + 1)) || "node";
}

function slug(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function assertValidId(id: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) {
    throw new GraphEditError(`"${id}" is not a usable node id: letters, digits, - and _, starting with a letter`);
  }
}

function sourceFor(module: string): string | undefined {
  if (module.startsWith("cascade.")) return "stdlib";
  if (module.startsWith("project.")) return "project";
  return undefined;
}

/** Port names that say nothing about what flows through them. */
const GENERIC_PORTS = new Set(["value", "output", "out", "input", "in", "result", "data"]);

function isBoundary(node: EditableNode): boolean {
  return moduleOf(node) === INPUT || moduleOf(node) === OUTPUT;
}

function portNumber(port: string): number {
  const match = /_(\d+)$/.exec(port);
  return match ? Number(match[1]) : -1;
}

function along(point: Point, step: Point): number {
  return point.x * step.x + point.y * step.y;
}
