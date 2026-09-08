# Cascade Vision

A free, open-source platform for long-term creative experimentation at FIELD.IO
and beyond: generative design sketches, interactive installations, brand
systems, and the reusable tools that connect them.

This is product intent. [README.md](README.md) describes current workflows;
[DESIGN.md](DESIGN.md) and [ARCHITECTURE.md](ARCHITECTURE.md) describe product
decisions and implementation boundaries.

## Author

**Marcus Wendt** <marcus@field.io>
[FIELD.IO](https://www.field.io) - Creative Intelligence Practice

## Core Ideas

**Infinite Visual Canvas**
Studio provides an infinite canvas for arranging graph stages and references.
The long-term aim is to connect research, images, text, media, data, and code
in an inspectable creative workspace. Algorithms remain usable outside that
workspace through the runtime.

**Iteration & Exploration**
An experiment should be easy to vary, understand, revisit, and share. A useful
result should retain the inputs and decisions that produced it, and a promising
sketch should have a path into an interactive experience or rendered asset set.

**Flexible & Extendable**
Users can create new node types and graph elements with custom code, parameters, visual components, and editors. The framework adapts to your workflow, not the other way around.

**Open & Long-Term**
Cascade is MIT-licensed and built on web technologies and ordinary project
files. The core workflow should remain usable without a paid account or AI
provider. Projects own their code and assets; external services, models, fonts,
and media retain their own costs and usage terms.

Team reuse is a product goal: someone should be able to open a colleague's
experiment, understand its public controls, make a variation, and preserve the
result. Documentation, reproducible examples, and maintainable interfaces are
part of that work.

## Product Shape

Cascade has three deliberately separate surfaces: a browser Studio for authoring,
a local server for project files and trusted process capabilities, and a neutral
headless runtime for embedded or backend execution. Projects own their custom
nodes, panels, settings, and renderers; the Cascade core stays project-agnostic.

## Acknowledgements

Cascade draws inspiration from pioneering tools in visual programming and procedural content creation:

- [Variable Nodes.IO](https://nodes.io) - The original inspiration for code-as-nodes
- [SideFX Houdini](https://www.sidefx.com) - Procedural workflows and node-based thinking
- [Derivative TouchDesigner](https://derivative.ca) - Real-time visual programming for creative coding

---

*This document captures our guiding principles. Refer back to it as the project evolves to ensure we stay true to the core vision.*
