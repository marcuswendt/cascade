# Changelog

All notable changes to Cascade will be documented in this file.

## [0.3.0] - December 2024

### Performance Optimizations

- O(1) node, port, and connection lookups using Map indices
- Lazy (pull-based) graph evaluation - only compute what's needed
- Parallel node execution for independent branches
- Lightweight value fingerprinting (avoid expensive JSON.stringify)
- RAF-based viewer polling with throttling
- Zoom center caching for smooth canvas interaction
- Timer node cleanup (memory leak fix)

### Lens System (Image Processing)

- High-performance `ImageBuffer` class with Float32Array channels
- 9 built-in image processing nodes:
  - Generators: Checkers, Color, Noise, Ramp
  - Filters: Blur (box, gaussian, bilateral), Composite, Resize, NormalMap, Image
- Resolution control system (input1/input2/largest/smallest/custom)
- Fit modes: Fill, Fit, Stretch, Native
- 20+ blend modes in Composite node
- Bilinear interpolation for resize operations

### Testing Infrastructure

- 605+ tests across 23 test files
- Performance regression tests for critical paths
- Workflow integration tests
- AI code generation tests
- UI testing setup with jsdom

### UI Improvements

- Color-coded ports by data type
- Custom node creation dialog with base class selection
- Dynamic subnet ports from Input/Output nodes
- Improved viewer with ImageBuffer support

## [0.2.0] - December 2024

### Major Changes

- Upgraded to Svelte 5 with modern runes-based reactivity
- Dockview integration for flexible panel management
  - Drag and drop panels to rearrange layout
  - Add new panels with "+" button in tab headers
  - Minimize/restore panels by clicking tab titles
  - Layout auto-saved to localStorage

### Features

- Undo/redo functionality (Cmd+Z / Cmd+Shift+Z)
- Select all nodes and annotations (Cmd+A)
- Consolidated node picker (Create menu and Tab-menu share same component)
- Unified nodes and annotations with common base class hierarchy
- Improved annotation positioning and grouping
- Streamlined UI: moved file menu into Graph tab header

### Bug Fixes

- Fixed node type serialization bug causing "Invalid node type format" errors
- Enhanced graph serialization and node ID handling
- Improved node execution and connection logic

## [0.1.0] - November 2024

### Initial Release

- Complete visual programming framework
- Live code editing with Monaco Editor
- NPM package integration via esm.sh CDN
- Asset management system (images, audio, data)
- Export to standalone HTML files
- Modern UI with keyboard shortcuts

### Core Features

- Node System with id, type, name, position, preview
- Port System with trigger and param ports
- Graph execution engine with topological sort
- Canvas with pan/zoom functionality
- Connection drawing between ports
- State preservation during recompilation

### Editor Features

- Monaco Editor integration with TypeScript support
- Double-click to edit node code
- Shift+Enter compilation
- Error display on nodes
- Package search (Cmd+K)
- Inspector panel for node parameters

---

## Historical Development

Development phase documentation archived in `spec/archive/`:

- Phase 1-3 implementation checklist
- Phase 8 completion report
- Dockview migration spec
- Settings panel implementation
- Implementation status reports
