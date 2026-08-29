<script lang="ts">
  import {
    Settings, Plus, X, Triangle, Ruler, Timer, MousePointer2, Keyboard,
    Eye, Save, Palette, Droplets, Sun, Sliders, Camera, Volume2, Zap,
    FileText, FolderOpen, Copy, Package, Info, Clock, Check, CheckCircle,
    XCircle, MoveUpLeft, Hand, Waves, ChevronDown, ChevronRight,
    SlidersHorizontal, GitBranch, Terminal, Network, Workflow, ScrollText,
    Type, Image, Folder, Minus, PenTool, StickyNote, FileImage, Square,
    Grid3x3, Cloud, Blend, Lightbulb, Box, Move, Maximize2, Layers,
    GitMerge, Dice5, ListFilter, Snowflake, LogIn, LogOut, ArrowUp,
    // Added for project nodes, which pick their own icon so a pipeline is
    // readable at a glance rather than twenty identical cogs.
    CloudSun, Telescope, Rainbow, Mountain, Crop, Contrast, Scan, Spline,
    Dot, Grid2x2, Tag, Aperture, Gauge, Wind, Combine, Group, FileOutput,
    Sparkles, Binary, Radar
  } from '@lucide/svelte';

  export let name: string;
  export let size: number = 16;
  export let color: string | undefined = undefined;
  export let strokeWidth: number = 2;
  // `class` is reserved as a `let` binding name — the standard Svelte
  // re-export idiom lets callers still write `<Icon class="...">` while
  // this forwards it to the underlying Lucide Svelte component, which
  // does accept it natively (renders straight onto the SVG element).
  let className: string = '';
  export { className as class };

  // Map icon names to Lucide components
  const iconMap: Record<string, any> = {
    Settings, Plus, X, Triangle, Ruler, Timer, MousePointer2, Keyboard,
    Eye, Save, Palette, Droplets, Sun, Sliders, Camera, Volume2, Zap,
    FileText, FolderOpen, Copy, Package, Info, Clock, Check, CheckCircle,
    XCircle, MoveUpLeft, Hand, Waves, ChevronDown, ChevronRight,
    SlidersHorizontal, Network, Workflow, ScrollText, Type, Image, Folder,
    Minus, PenTool, StickyNote, FileImage, Square, Box, Move, Maximize2,
    Layers, GitMerge, Dice5, ListFilter, Snowflake, LogIn, LogOut, ArrowUp,
    CloudSun, Telescope, Rainbow, Mountain, Crop, Contrast, Scan, Spline,
    Dot, Grid2x2, Tag, Aperture, Gauge, Wind, Combine, Group, FileOutput,
    Sparkles, Binary, Radar, Cloud, Blend, Lightbulb, Grid3x3, Terminal,
    // Aliases
    View: Eye,
    GitGraph: GitBranch,
    Logs: Terminal,
    Grid: Grid3x3,
    Gradient: Blend,
    GitBranch
  };
  
  $: IconComponent = iconMap[name] || Settings;
</script>

<svelte:component this={IconComponent} {size} {color} {strokeWidth} class={className} />
