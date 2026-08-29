# Cascade Version Information

## Current Version: 0.3.0

**Release Date**: December 2025
**Status**: Development / Beta

## Author

**Marcus Wendt** <marcus@field.io>
[FIELD.IO](https://www.field.io) - Creative Intelligence Practice

## What's New in 0.3.0

### Performance Optimizations

- O(1) node, port, and connection lookups using Map indices
- Lazy (pull-based) graph evaluation - only compute what's needed
- Parallel node execution for independent branches
- Lightweight value fingerprinting (avoid expensive JSON.stringify)
- RAF-based viewer polling with throttling
- Zoom center caching for smooth canvas interaction

### Lens System (Image Processing)

- High-performance `ImageBuffer` class with Float32Array channels
- 9 built-in image processing nodes:
  - Checkers, Color, Noise, Ramp (generators)
  - Blur, Composite, Resize, NormalMap, Image (filters/utilities)
- Resolution control system (input1/input2/largest/smallest/custom)
- Fit modes: Fill, Fit, Stretch, Native
- 20+ blend modes in Composite node

### Testing Infrastructure

- 605+ tests across 23 test files
- Performance regression tests for critical paths
- Workflow integration tests
- AI code generation tests

### Other Improvements

- Color-coded ports by data type
- Custom node creation dialog with base class selection
- Dynamic subnet ports from Input/Output nodes
- Parallel node execution during project load
- Timer node cleanup (no more memory leaks)

## Previous Versions

### 0.2.0 (December 2025)

- Svelte 5 upgrade with runes-based reactivity
- Dockview integration for flexible panel management
- Undo/redo functionality (Cmd+Z / Cmd+Shift+Z)
- Unified nodes and annotations with common base class
- Improved graph serialization

### 0.1.0

- Initial release
- Visual programming framework
- Live code editing with Monaco Editor
- NPM package integration
- Asset management system
- Export to standalone HTML

## System Requirements

- Node.js 18+
- Modern browser (Chrome, Firefox, Safari, Edge)
- 4GB RAM minimum
- Internet connection (for NPM package loading)

## Build Information

- Framework: Svelte 5
- Language: TypeScript 5
- Bundler: Vite 6
- Editor: Monaco Editor 0.52
- Test Framework: Vitest

## Acknowledgements

- [Variable Nodes.IO](https://nodes.io) - The original inspiration
- [SideFX Houdini](https://www.sidefx.com) - Procedural workflows
- [Derivative TouchDesigner](https://derivative.ca) - Real-time visual programming

## License

See [LICENSE](./LICENSE) for details.

---

For detailed changelog, see [spec/CHANGELOG.md](./spec/CHANGELOG.md)
