<script lang="ts">
  // One deep import per icon, never the `@lucide/svelte` barrel: the barrel
  // pulls in every Lucide icon (~4.8 s of module loading per test file and
  // per dev-server cold start). Production tree-shakes either way. Use the
  // canonical file name (circle-x, not x-circle) so the types resolve.
  import Settings from '@lucide/svelte/icons/settings';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import Triangle from '@lucide/svelte/icons/triangle';
  import Ruler from '@lucide/svelte/icons/ruler';
  import Timer from '@lucide/svelte/icons/timer';
  import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2';
  import Keyboard from '@lucide/svelte/icons/keyboard';
  import Eye from '@lucide/svelte/icons/eye';
  import Save from '@lucide/svelte/icons/save';
  import Palette from '@lucide/svelte/icons/palette';
  import Droplets from '@lucide/svelte/icons/droplets';
  import Sun from '@lucide/svelte/icons/sun';
  import Sliders from '@lucide/svelte/icons/sliders-vertical';
  import Camera from '@lucide/svelte/icons/camera';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import Zap from '@lucide/svelte/icons/zap';
  import FileText from '@lucide/svelte/icons/file-text';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Copy from '@lucide/svelte/icons/copy';
  import Package from '@lucide/svelte/icons/package';
  import Info from '@lucide/svelte/icons/info';
  import Clock from '@lucide/svelte/icons/clock';
  import Check from '@lucide/svelte/icons/check';
  import CheckCircle from '@lucide/svelte/icons/circle-check-big';
  import XCircle from '@lucide/svelte/icons/circle-x';
  import MoveUpLeft from '@lucide/svelte/icons/move-up-left';
  import Hand from '@lucide/svelte/icons/hand';
  import Waves from '@lucide/svelte/icons/waves-horizontal';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Network from '@lucide/svelte/icons/network';
  import Workflow from '@lucide/svelte/icons/workflow';
  import ScrollText from '@lucide/svelte/icons/scroll-text';
  import Type from '@lucide/svelte/icons/type';
  import Image from '@lucide/svelte/icons/image';
  import Folder from '@lucide/svelte/icons/folder';
  import Minus from '@lucide/svelte/icons/minus';
  import PenTool from '@lucide/svelte/icons/pen-tool';
  import StickyNote from '@lucide/svelte/icons/sticky-note';
  import FileImage from '@lucide/svelte/icons/file-image';
  import Square from '@lucide/svelte/icons/square';
  import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
  import Cloud from '@lucide/svelte/icons/cloud';
  import Blend from '@lucide/svelte/icons/blend';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import Box from '@lucide/svelte/icons/box';
  import Move from '@lucide/svelte/icons/move';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import Layers from '@lucide/svelte/icons/layers';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import Dice5 from '@lucide/svelte/icons/dice-5';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import Snowflake from '@lucide/svelte/icons/snowflake';
  import LogIn from '@lucide/svelte/icons/log-in';
  import LogOut from '@lucide/svelte/icons/log-out';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  // Added for project nodes, which pick their own icon so a pipeline is
  // readable at a glance rather than twenty identical cogs.
  import CloudSun from '@lucide/svelte/icons/cloud-sun';
  import Telescope from '@lucide/svelte/icons/telescope';
  import Rainbow from '@lucide/svelte/icons/rainbow';
  import Mountain from '@lucide/svelte/icons/mountain';
  import Crop from '@lucide/svelte/icons/crop';
  import Contrast from '@lucide/svelte/icons/contrast';
  import Scan from '@lucide/svelte/icons/scan';
  import Spline from '@lucide/svelte/icons/spline';
  import Dot from '@lucide/svelte/icons/dot';
  import Grid2x2 from '@lucide/svelte/icons/grid-2x2';
  import Tag from '@lucide/svelte/icons/tag';
  import Aperture from '@lucide/svelte/icons/aperture';
  import Gauge from '@lucide/svelte/icons/gauge';
  import Wind from '@lucide/svelte/icons/wind';
  import Combine from '@lucide/svelte/icons/combine';
  import Group from '@lucide/svelte/icons/group';
  import FileOutput from '@lucide/svelte/icons/file-output';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Binary from '@lucide/svelte/icons/binary';
  import Radar from '@lucide/svelte/icons/radar';
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';

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
    Sparkles, Binary, Radar, ArrowRightLeft, Cloud, Blend, Lightbulb, Grid3x3, Terminal,
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
