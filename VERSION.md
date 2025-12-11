# Cascade Version Information

## Current Version: 0.2

**Release Date**: December 11, 2025
**Status**: Development / Beta

### What's New in 0.2

- **Upgraded to Svelte 5** with modern runes-based reactivity
- **Dockview integration** for flexible panel management
  - Drag and drop panels to rearrange layout
  - Add new panels with "+" button in tab headers
  - Minimize/restore panels by clicking tab titles
  - Rotated tab headers for horizontally collapsed panels
  - Layout auto-saved to localStorage
- Undo/redo functionality (Cmd+Z / Cmd+Shift+Z)
- Select all nodes and annotations (Cmd+A)
- Consolidated node picker (Create menu and Tab-menu share same component)
- Fixed node type serialization bug causing "Invalid node type format" errors
- Modernized codebase with upgraded dependencies and type constants
- Unified nodes and annotations with common base class hierarchy
- Improved annotation positioning and grouping
- Streamlined UI: moved file menu into Graph tab header
- Enhanced graph serialization and node ID handling
- Improved node execution and connection logic

### Previous Version (0.1)

- Complete visual programming framework
- Live code editing with Monaco Editor
- NPM package integration
- Asset management system
- Export to standalone HTML
- Modern UI with keyboard shortcuts

### System Requirements

- Node.js 18+
- Modern browser (Chrome, Firefox, Safari, Edge)
- 4GB RAM minimum
- Internet connection (for NPM package loading)

### Build Information

- Framework: Svelte 5
- Language: TypeScript 5
- Bundler: Vite 5
- Editor: Monaco Editor 0.44
- Package Manager: npm

---

For detailed changelog, see [CHANGELOG.md](./CHANGELOG.md)
