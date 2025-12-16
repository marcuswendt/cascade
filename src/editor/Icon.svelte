<script lang="ts">
  import {
    Settings, Plus, X, Triangle, Ruler, Timer, MousePointer2, Keyboard,
    Eye, Save, Palette, Droplets, Sun, Sliders, Camera, Volume2, Zap,
    FileText, FolderOpen, Copy, Package, Info, Clock, Check, CheckCircle,
    XCircle, MoveUpLeft, Hand, Waves, ChevronDown, ChevronRight,
    SlidersHorizontal, GitBranch, Terminal, Network, Workflow, ScrollText,
    Type, Image, Folder, Minus, PenTool, StickyNote, FileImage, Square,
    Grid3x3, Cloud, Blend, Lightbulb, Box, Move, Maximize2, Layers,
    GitMerge, Dice5, ListFilter, Snowflake, LogIn, LogOut
  } from 'lucide-svelte';

  export let name: string;
  export let size: number = 16;
  export let color: string | undefined = undefined;
  export let strokeWidth: number = 2;

  // Map icon names to Lucide components
  const iconMap: Record<string, any> = {
    Settings, Plus, X, Triangle, Ruler, Timer, MousePointer2, Keyboard,
    Eye, Save, Palette, Droplets, Sun, Sliders, Camera, Volume2, Zap,
    FileText, FolderOpen, Copy, Package, Info, Clock, Check, CheckCircle,
    XCircle, MoveUpLeft, Hand, Waves, ChevronDown, ChevronRight,
    SlidersHorizontal, Network, Workflow, ScrollText, Type, Image, Folder,
    Minus, PenTool, StickyNote, FileImage, Square, Box, Move, Maximize2,
    Layers, GitMerge, Dice5, ListFilter, Snowflake, LogIn, LogOut,
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

<svelte:component this={IconComponent} {size} {color} {strokeWidth} />

