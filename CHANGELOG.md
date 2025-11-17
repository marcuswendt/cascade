# Changelog

All notable changes to Cascade will be documented in this file.

## [1.0.0] - 2024-12-XX

### Added
- **Core Foundation** - Node, Graph, and Port system
- **Live Code Editing** - Monaco Editor integration with Shift+Enter compilation
- **State Preservation** - Nodes preserve state during recompilation
- **Asset Management** - Load and cache images, audio, and data files
- **NPM Integration** - Dynamic package loading via `node.require()`
- **Package Search** - Search and install NPM packages from the editor
- **Export System** - Export graphs to standalone HTML files
- **UI Components**:
  - Bottom toolbar with node categories
  - Node creation panel with search
  - Inspector panel for node parameters
  - Document panel with file operations
  - Presentation mode
- **Canvas Features**:
  - Pan (middle mouse, space+drag, two-finger drag)
  - Zoom (mouse wheel, pinch gesture)
  - Node dragging
  - Port connections
- **Keyboard Shortcuts**:
  - Tab - Open node creation
  - ⌘K/Ctrl+K - Search packages
  - Shift+Enter - Compile code
  - Esc - Close panels
  - ⌘N/O/S/E - File operations
- **Example Projects** - Hello World and Counter examples

### Fixed
- Async/await support in node code compilation
- CORS handling for NPM registry search
- TypeScript errors in build configuration
- State preservation during node recompilation
- Canvas centering on node load

### Changed
- Improved zoom sensitivity (5x faster)
- Auto-center canvas when opening/creating projects
- Package search gracefully handles network errors

### Technical Details
- Built with Svelte 4, TypeScript, Vite
- Monaco Editor for code editing
- ESM.sh CDN for NPM package loading
- Standalone HTML export with embedded assets

---

## Future Releases

### Planned
- More built-in node templates
- Node library expansion
- Performance optimizations
- Additional export formats
- Collaboration features

