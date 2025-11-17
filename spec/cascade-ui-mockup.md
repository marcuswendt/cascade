# Cascade UI Visual Mockup

## Full Interface (Normal Mode)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  Cascade  [File] [Edit] [View] [Graph]           [Assets 📁] [Export 📦] [Help ?]     │ ← Menu Bar (40px)
├────────┬───────────────────────────────────────────────────────────────────┬────────────┤
│ Layers │                                                                   │ Inspector  │
│  [+]   │                                                                   │            │
│        │                                                                   │  ┌──────┐  │
│ [📥]   │                                                                   │  │Width │  │
│ Input  │                    Canvas Area (Graph)                           │  │[800] │  │
│        │                                                                   │  ├──────┤  │
│ [➕]   │                                                                   │  │Height│  │
│ Math   │         ┌─────────┐                                              │  │[600] │  │
│        │         │ Timer   │                                              │  ├──────┤  │
│ [🔄]   │         │  fps:60 │───┬────────────┐                            │  │Scale │  │
│ Flow   │         └─────────┘   │            │                            │  │[0.01]│  │
│        │                       ▼            ▼                             │  └──────┘  │
│ [👁]    │              ┌──────────┐  ┌──────────┐                          │            │
│ Viewer │              │FlowField │  │Particles │                          │  Preview:  │
│        │              │  800x600 │──│  5000    │                          │  ┌──────┐  │
│ Search │              └──────────┘  └──────────┘                          │  │[img] │  │
│ [🔍]   │                                   │                               │  └──────┘  │
│ [___]  │                                   │                               │            │
│        │                                   ▼                               │  [Apply]   │
│        │                            ┌──────────┐                           │            │
│        │                            │ Viewer   │                           │  Logs:     │
│        │                            │          │                           │  > Ready   │
│        │                            └──────────┘                           │            │
│        │                                                                   │            │
│  240px │                          1920×1080                                │    320px   │
├────────┴───────────────────────────────────────────────────────────────────┴────────────┤
│  [↖] [✋] │ [📥Input] [➕Math] [🎨Lens] [🎲3D] [🔊Audio] [🔀Logic] [📤Output] │ [⚙Settings]│ ← Bottom Toolbar (56px)
└────────────────────────────────────────────────────────────────────────────────────────┘
   Tools        Node Categories (click to expand panel)                         Config
```

---

## Bottom Toolbar (Node Category Expanded)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          Canvas Area (Graph View)                                      │
│                                                                                        │
│                              [Nodes visible here]                                      │
│                                                                                        │
│                                                                                        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  Math Nodes                                                                      [×]   │ ← Panel (400px height)
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │   [➕]   │   [➖]   │   [✖️]   │   [➗]   │   [%]    │   [^]    │   [√]    │      │
│  │   Add    │ Subtract │ Multiply │  Divide  │  Modulo  │  Power   │   Root   │      │
│  ├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤      │
│  │   [~]    │   [cos]  │   [tan]  │   [min]  │   [max]  │   [↕]    │   [↔]    │      │
│  │   Sin    │   Cos    │   Tan    │   Min    │   Max    │  Clamp   │  Remap   │      │
│  ├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤      │
│  │   [⌊]    │   [⌈]    │   [∿]    │   [▶️]   │   [🎯]   │   [📐]   │   [📊]   │      │
│  │  Floor   │   Ceil   │  Round   │  Lerp    │  Vector  │  Matrix  │Expression│      │
│  └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘      │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  [↖] [✋] │ [📥Input] [➕Math] [🎨Lens] [🎲3D] [🔊Audio] [🔀Logic] [📤Output] │ [⚙Settings]│
│             └─────────────┘ (active - highlighted)                                     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Presentation Mode (⌘. - No Selection)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                        │
│                                                                                        │
│                                                                                        │
│                                                                                        │
│                                                                                        │
│                          Canvas Area (Full Screen)                                     │
│                                                                                        │
│                         ┌─────────┐                                                    │
│                         │ Timer   │                                                    │
│                         │  fps:60 │───┬────────────┐                                  │
│                         └─────────┘   │            │                                  │
│                                      ▼            ▼                                   │
│                             ┌──────────┐  ┌──────────┐                                │
│                             │FlowField │  │Particles │                                │
│                             │  800x600 │──│  5000    │                                │
│                             └──────────┘  └──────────┘                                │
│                                                │                                       │
│                                                ▼                                       │
│                                         ┌──────────┐                                   │
│                                         │ Viewer   │                                   │
│                                         │          │                                   │
│                                         └──────────┘                                   │
│                                                                                        │
│                           (All UI hidden - press ⌘. to restore)                       │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Presentation Mode (⌘. - Node Selected)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                        │
│                                                              ┌──────────────────────┐  │
│                                                              │ FlowField Node       │  │
│                                                              ├──────────────────────┤  │
│                                                              │                      │  │
│                         Canvas Area                          │  Width               │  │
│                                                              │  [■■■■■■■───] 800    │  │
│                                                              │                      │  │
│                         ┌─────────┐                          │  Height              │  │
│                         │ Timer   │                          │  [■■■■■───────] 600  │  │
│                         │  fps:60 │───┬────────────┐         │                      │  │
│                         └─────────┘   │            │         │  Scale               │  │
│                                      ▼            ▼         │  [■─────────] 0.01   │  │
│                             ┌──────────┐  ┌──────────┐       │                      │  │
│                             │FlowField │  │Particles │       │  Colors              │  │
│                             │  800x600 │──│  5000    │       │  ┌────┬────┬────┐   │  │
│                             └─▲────────┘  └──────────┘       │  │[🔵]│[🟣]│[⚪]│   │  │
│                               │                               │  └────┴────┴────┘   │  │
│                           (Selected)                          │                      │  │
│                                                              │  ┌────────────────┐  │  │
│                                                              │  │   Generate     │  │  │
│                                                              │  └────────────────┘  │  │
│                                                              │                      │  │
│                                                              │  Preview:            │  │
│                                                              │  ┌────────────────┐  │  │
│                                                              │  │ [noise image]  │  │  │
│                                                              │  └────────────────┘  │  │
│                        (Inspector appears on right)          │                      │  │
│                                                              └──────────────────────┘  │
│                                                                       320px            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Node Category Panel - Detailed View

### Lens (Image Processing) Category

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  Lens - Image Processing                                    [Search: ____]       [×]   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  Filters & Effects                                                                     │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │   [∿]    │   [☀]    │   [🌈]   │   [📊]   │   [🔪]   │   [〰️]   │   [🎭]   │      │
│  │   Blur   │Brightness│   Hue    │Threshold │  Edge    │ Distort  │  Blend   │      │
│  │  Smooth  │ Contrast │Saturation│  Binary  │ Detect   │  Warp    │  Modes   │      │
│  │  images  │  Adjust  │  Shift   │  Convert │  Sobel   │ Effects  │ Multiply │      │
│  │          │  levels  │  colors  │  values  │  filter  │  noise   │  Overlay │      │
│  │  ⭐ 245  │  ⭐ 189  │  ⭐ 156  │  ⭐ 98   │  ⭐ 134  │  ⭐ 167  │  ⭐ 203  │      │
│  └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘      │
│                                                                                        │
│  Advanced                                                                              │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │   [⚡]   │   [🔁]   │   [🌟]   │   [🔳]   │   [🎨]   │   [📐]   │   [🎯]   │      │
│  │ Convolve │ Feedback │Chromatic │ Vignette │  Color   │  Remap   │  LUT     │      │
│  │  Matrix  │   Loop   │Aberration│  Darken  │  Grade   │  Values  │  Apply   │      │
│  │  kernel  │  effects │ RGB split│  edges   │ Correct  │  ranges  │  lookup  │      │
│  │  filter  │  buffer  │  glitch  │  mask    │  curves  │  scale   │  table   │      │
│  │  ⭐ 87   │  ⭐ 145  │  ⭐ 201  │  ⭐ 112  │  ⭐ 178  │  ⭐ 93   │  ⭐ 67   │      │
│  └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘      │
│                                                                                        │
│  Showing 14 of 14 nodes                                     [View as List]            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Custom Category (Favorites + NPM)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  Custom                                                      [Search: ____]       [×]   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  ⭐ Your Favorites                                                                     │
│  ┌──────────┬──────────┬──────────┬──────────┐                                        │
│  │   [∿]    │   [🎲]   │   [🔊]   │   [🌐]   │                                        │
│  │PerlinGen │ ThreeCube│   FFT    │  Fetch   │                                        │
│  │  (Drag to remove from favorites)          │                                        │
│  └──────────┴──────────┴──────────┴──────────┘                                        │
│                                                                                        │
│  📦 NPM Packages                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐                      │
│  │  🔍  Search npm packages...                          [Go]   │                      │
│  └─────────────────────────────────────────────────────────────┘                      │
│                                                                                        │
│  Try these popular packages:                                                          │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐                            │
│  │  [three] │  [tone]  │  [d3]    │[chroma-js]│[matter-js]                            │
│  │  Three.js│  Tone.js │   D3     │  Colors  │ Physics  │                            │
│  │    3D    │  Audio   │   Data   │ Palettes │  Engine  │                            │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘                            │
│                                                                                        │
│  📝 Recently Used                                                                      │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐                            │
│  │   [➕]   │   [∿]    │   [🎨]   │   [📸]   │   [⏱]    │                            │
│  │   Add    │   Blur   │  Hue     │  Image   │  Timer   │                            │
│  │  Math    │  Filter  │  Shift   │  Loader  │  Clock   │                            │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘                            │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Toolbar States & Interactions

### Default State (Idle)
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  [↖] [✋] │ [📥Input] [➕Math] [🎨Lens] [🎲3D] [🔊Audio] [🔀Logic] [📤Output] │ [⚙Settings]│
│            └──────────────────────────────────────────────────────────────┘            │
│            Semi-transparent dark: rgba(20, 20, 20, 0.95)                              │
│            All buttons equal weight, subtle hover states                              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Hover State
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  [↖] [✋] │ [📥Input] [➕Math] [🎨Lens] [🎲3D] [🔊Audio] [🔀Logic] [📤Output] │ [⚙Settings]│
│                       ▲                                                                │
│                       │                                                                │
│                  Hovered button lifts 2px, background: rgba(255, 255, 255, 0.05)      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Active State (Category Open)
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  [↖] [✋] │ [📥Input] [➕Math] [🎨Lens] [🎲3D] [🔊Audio] [🔀Logic] [📤Output] │ [⚙Settings]│
│                       ▲                                                                │
│                       │                                                                │
│                  Active: 2px blue top border, bg: rgba(66, 133, 244, 0.2)             │
│                  Panel appears above toolbar with matching width                       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Ghost Node (Click-to-Place Mode)
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                        │
│                              ┌──────────┐ ← Follows cursor                            │
│                              │   Blur   │   (semi-transparent)                        │
│                              │  Filter  │   Can snap to grid if enabled               │
│                              └──────────┘   Click canvas to place                     │
│                                  👆                                                    │
│                              Cursor                                                    │
│                                                                                        │
│  Press ESC to cancel placement                                                         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Keyboard Shortcut Overlay

Press **?** to show:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────┐     │
│  │  Keyboard Shortcuts                                                     [×]  │     │
│  ├──────────────────────────────────────────────────────────────────────────────┤     │
│  │                                                                              │     │
│  │  Tools                         Canvas                  View                 │     │
│  │  ─────                         ──────                  ────                 │     │
│  │  V      Select tool            ⌘+     Zoom in          ⌘.    Presentation  │     │
│  │  H      Hand tool              ⌘-     Zoom out         ⌘B    Toggle toolbar│     │
│  │  Tab    Quick search           ⌘0     Reset zoom       ⌘/    Toggle left   │     │
│  │  Space  Pan (hold)             ⌘1     Fit all          ⌘;    Toggle right  │     │
│  │                                ⌘2     Fit selected     ⌘\    Zen mode      │     │
│  │                                                                              │     │
│  │  Nodes                         Execution                                    │     │
│  │  ─────                         ─────────                                    │     │
│  │  ⌘D     Duplicate              ⌘Enter Run graph                             │     │
│  │  Delete Delete                 ⌘K     Stop                                 │     │
│  │  ⌘C/V   Copy/Paste             ⌘R     Reset all                            │     │
│  │  ⌘G     Group                  ⇧Enter Compile (in editor)                  │     │
│  │                                                                              │     │
│  └──────────────────────────────────────────────────────────────────────────────┘     │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Mobile/Tablet Adaptation

### iPhone (Portrait)
```
┌─────────────────────────────┐
│  Cascade          [☰]  [?]  │ ← Menu
├─────────────────────────────┤
│                             │
│                             │
│        Canvas Area          │
│        (Full Width)         │
│                             │
│      ┌─────────┐            │
│      │  Node   │            │
│      └─────────┘            │
│                             │
│                             │
├─────────────────────────────┤
│  [☰] [▾More]                │ ← Bottom toolbar (collapsed)
└─────────────────────────────┘

Tap [▾More]:
┌─────────────────────────────┐
│  Node Categories       [×]  │ ← Full-screen panel
│  ─────────────────────      │
│  📥 Input                   │
│  ➕ Math                    │
│  🎨 Lens                    │
│  🎲 3D                      │
│  🔊 Audio                   │
│  🔀 Logic                   │
│  📤 Output                  │
│                             │
│  Tap category to expand →   │
└─────────────────────────────┘
```

### iPad (Landscape)
```
┌────────────────────────────────────────────────────────────────────────┐
│  Cascade  [File] [Edit]                          [Assets] [?]         │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│                          Canvas Area                                   │
│                                                                        │
│         ┌─────────┐                                                    │
│         │  Node   │                                                    │
│         └─────────┘                                                    │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│  [↖] │ [📥] [➕] [🎨] [🎲] [🔊] [🔀] [📤] [»]              │ [⚙]      │
└────────────────────────────────────────────────────────────────────────┘
     Scrollable categories (swipe left/right)
```

---

## Design System Colors

```css
/* Light on Dark Theme */
--bg-canvas: #0a0a0a;
--bg-toolbar: rgba(20, 20, 20, 0.95);
--bg-panel: rgba(30, 30, 30, 0.98);
--bg-card: #282828;
--bg-card-hover: #3c3c3c;

--border-subtle: rgba(255, 255, 255, 0.1);
--border-emphasis: rgba(255, 255, 255, 0.2);

--text-primary: #ffffff;
--text-secondary: rgba(255, 255, 255, 0.7);
--text-tertiary: rgba(255, 255, 255, 0.5);

--accent-blue: #4285f4;
--accent-green: #34a853;
--accent-yellow: #fbbc04;
--accent-red: #ea4335;

/* Category Colors */
--category-input: #4285f4;    /* Blue */
--category-math: #34a853;     /* Green */
--category-lens: #ea4335;     /* Red */
--category-3d: #9c27b0;       /* Purple */
--category-audio: #ff9800;    /* Orange */
--category-logic: #00bcd4;    /* Cyan */
--category-output: #8bc34a;   /* Light Green */
```

---

## Summary: Key UI Improvements

✅ **FigJam-inspired bottom toolbar** - Professional, familiar interface
✅ **Category-based organization** - Easy to find nodes
✅ **Quick search within categories** - Fast workflow
✅ **Drag-to-add OR click-to-place** - Flexible node creation
✅ **Presentation mode (⌘.)** - Distraction-free editing
✅ **Smart inspector** - Appears only when needed in presentation mode
✅ **Favorites & Recent** - Personalized quick access
✅ **NPM integration** - Add any package as a node
✅ **Mobile-friendly** - Responsive design for tablets
✅ **Full keyboard control** - Power user shortcuts

This creates a **modern, efficient workflow** that feels as polished as Figma or TouchDesigner! 🎨
