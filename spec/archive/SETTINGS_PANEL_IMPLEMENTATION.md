# Settings Panel Implementation Plan

## Overview
Implement a user preferences panel accessible via **File > Settings** (⌘,) with tabbed sections, distinguishing between **User Settings** (machine-local) and **Project Settings** (saved with graph).

---

## Settings Scope

### User Settings (localStorage)
Machine-local preferences that should NOT be shared in project files:
- **API Keys** - Sensitive credentials, never serialized to graph
- **Appearance** - Theme, font size, UI preferences
- **Editor** - Auto-save, keybindings, default behaviors

### Project Settings (saved in graph JSON)
Project-specific configuration that travels with the file:
- **Default Library** - Which node library to load by default
- **Execution** - Default cook mode, auto-execute on load
- **Metadata** - Author, description, version notes
- **Canvas** - Default zoom, grid snap settings

This separation ensures:
1. API keys are never accidentally shared when exporting/sharing projects
2. Project-specific settings stay with the project
3. User preferences apply across all projects

---

## Architecture

### Approach: Modal Dialog
Following the `ExportDialog.svelte` pattern - a modal overlay dialog rather than a Dockview panel. This is appropriate because:
- Settings are accessed occasionally, not permanently docked
- Matches standard OS conventions (⌘, opens modal settings)
- Keeps the workspace uncluttered

### Files to Create

| File | Purpose |
|------|---------|
| `src/editor/SettingsDialog.svelte` | Main settings modal with tabbed navigation |
| `src/editor/stores/settingsStore.ts` | Persistent settings state (localStorage) |

### Files to Modify

| File | Change |
|------|--------|
| `src/editor/MenuBar.svelte` | Add "Settings..." menu item to File menu |
| `src/App.svelte` | Add ⌘, keyboard shortcut + settings dialog state |

---

## Data Model

```typescript
// settingsStore.ts - USER SETTINGS (localStorage)

interface APIKeyEntry {
  id: string;           // UUID for key
  service: string;      // "anthropic" | "openai" | "google" | "custom"
  label: string;        // Display name, e.g. "Anthropic Claude"
  key: string;          // The actual API key (stored locally)
  endpoint?: string;    // Optional custom endpoint for "custom" services
}

interface UserSettings {
  apiKeys: APIKeyEntry[];
  appearance: {
    // Future: theme, accentColor, fontSize
  };
  editor: {
    // Future: autoSave, defaultZoom
  };
}
```

```typescript
// PROJECT SETTINGS (saved in graph.toJSON())

interface ProjectSettings {
  defaultLibrary?: string;      // Which node library to auto-load
  autoExecuteOnLoad?: boolean;  // Run graph when file opens
  metadata?: {
    author?: string;
    description?: string;
    version?: string;
  };
}

// Extend existing Graph serialization to include:
// graph.settings: ProjectSettings
```

### Default Services (for API Keys)

Predefined service options for the dropdown:

- **Anthropic Claude** (`anthropic`)
- **OpenAI ChatGPT** (`openai`)
- **Google Gemini** (`google`)
- **Custom** (`custom`) - allows custom label and endpoint (e.g., Localhost ComfyUI)

---

## UI Design

### Dialog Structure

```text
┌─────────────────────────────────────────────────┐
│  Settings                                    ✕  │
├─────────────────────────────────────────────────┤
│  USER                        PROJECT            │
│  ┌──────────┐ ┌──────────┐   ┌──────────┐      │
│  │ API Keys │ │ Appearance│   │ Project  │      │  ← Tab buttons
│  └──────────┘ └──────────┘   └──────────┘      │
├─────────────────────────────────────────────────┤
│                                                 │
│  API Keys                                       │
│  ─────────────────────────────────────────────  │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ Service: [Anthropic Claude    ▼]        │   │
│  │ Key:     [••••••••••••••••••••] 👁      │   │
│  │                                    [✕]  │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ Service: [Custom               ▼]       │   │
│  │ Label:   [ComfyUI Localhost   ]         │   │
│  │ Endpoint:[http://localhost:8188]        │   │
│  │ Key:     [••••••••••••••••••••] 👁      │   │
│  │                                    [✕]  │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [ + Add API Key ]                              │
│                                                 │
├─────────────────────────────────────────────────┤
│                              [Cancel]  [Save]   │
└─────────────────────────────────────────────────┘
```

### Tab Sections (expandable)
1. **API Keys** (implemented now)
2. **Appearance** (placeholder for future: theme, accent color)
3. **Editor** (placeholder for future: font size, auto-save)

---

## Implementation Steps

### Step 1: Create `settingsStore.ts`
```typescript
// src/editor/stores/settingsStore.ts
import { writable, get } from 'svelte/store';

const STORAGE_KEY = 'cascade-settings';

// ... interfaces ...

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
  return { apiKeys: [] };
}

function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// Writable store with auto-persist
const settings = writable<Settings>(loadSettings());

// Subscribe to auto-save changes
settings.subscribe(value => saveSettings(value));

// Export helper functions
export function getApiKey(service: string): string | undefined { ... }
export function addApiKey(entry: Omit<APIKeyEntry, 'id'>): void { ... }
export function updateApiKey(id: string, updates: Partial<APIKeyEntry>): void { ... }
export function removeApiKey(id: string): void { ... }

export { settings };
```

### Step 2: Create `SettingsDialog.svelte`
Following the ExportDialog pattern:
- Overlay with backdrop blur
- Escape to close
- Click outside to close
- Header with title and close button
- Tabbed content area
- Footer with Cancel/Save buttons

Key features for API Keys tab:
- Dynamic list of API key entries
- Service dropdown with presets + custom option
- Password-style input with reveal toggle
- Add/remove buttons
- Validation (non-empty key)

### Step 3: Update `MenuBar.svelte`
Add to `fileMenuItems` array (after Export, before About):
```typescript
{ type: 'separator' },
{ label: 'Settings...', action: 'settings', shortcut: '⌘,' },
```

### Step 4: Update `App.svelte`
1. Import and add `SettingsDialog` component
2. Add `settingsOpen` state variable
3. Add handler in `handleMenuAction`:
   ```typescript
   case 'settings':
     settingsOpen = true;
     break;
   ```
4. Add keyboard shortcut handler:
   ```typescript
   // ⌘, - Settings
   if ((e.metaKey || e.ctrlKey) && e.key === ',') {
     e.preventDefault();
     settingsOpen = true;
   }
   ```
5. Add dialog to template:
   ```svelte
   <SettingsDialog bind:open={settingsOpen} />
   ```

---

## Security Considerations

- API keys stored in localStorage (client-side only)
- Keys displayed as password fields by default
- No transmission to external servers
- Clear warning in UI that keys are stored locally

---

## Future Expansion

The tabbed structure allows easy addition of:
- **Appearance**: Theme (dark/light), accent colors, font settings
- **Editor**: Auto-save interval, default zoom, grid settings
- **Keybindings**: Custom keyboard shortcut configuration
- **Plugins**: MCP server configuration (if applicable)

---

## Acceptance Criteria

- [ ] Settings accessible via File > Settings menu
- [ ] ⌘, (Cmd+comma) opens settings dialog
- [ ] Tabbed interface with API Keys as first tab
- [ ] Can add multiple API keys with service selection
- [ ] Can edit and delete existing API keys
- [ ] Keys persist across browser sessions (localStorage)
- [ ] Custom service option with label and endpoint fields
- [ ] Escape or click-outside closes dialog
- [ ] Dark theme matching existing app aesthetic
