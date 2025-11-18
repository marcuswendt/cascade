<script lang="ts">
  import * as icons from 'lucide-svelte';
  
  export let name: string;
  export let size: number = 16;
  export let color: string | undefined = undefined;
  export let strokeWidth: number = 2;
  
  // Map icon names to Lucide components
  const iconMap: Record<string, any> = {
    Settings: icons.Settings,
    Plus: icons.Plus,
    X: icons.X,
    Triangle: icons.Triangle,
    Ruler: icons.Ruler,
    Timer: icons.Timer,
    MousePointer2: icons.MousePointer2,
    Keyboard: icons.Keyboard,
    Eye: icons.Eye,
    Save: icons.Save,
    Palette: icons.Palette,
    Droplets: icons.Droplets,
    Sun: icons.Sun,
    Sliders: icons.Sliders,
    Camera: icons.Camera,
    Volume2: icons.Volume2,
    Zap: icons.Zap,
    FileText: icons.FileText,
    FolderOpen: icons.FolderOpen,
    Copy: icons.Copy,
    Package: icons.Package,
    Info: icons.Info,
    Clock: icons.Clock,
    Check: icons.Check,
    CheckCircle: icons.CheckCircle,
    XCircle: icons.XCircle,
    MoveUpLeft: icons.MoveUpLeft,
    Hand: icons.Hand,
    Waves: icons.Waves,
    ChevronDown: icons.ChevronDown,
    ChevronRight: icons.ChevronRight,
    View: icons.Eye,
    SlidersHorizontal: icons.SlidersHorizontal,
    GitGraph: icons.GitBranch,
    Logs: icons.Terminal,
    Network: icons.Network,
    Workflow: icons.Workflow,
    ScrollText: icons.ScrollText
  };
  
  $: IconComponent = iconMap[name] || icons.Settings;
</script>

<svelte:component this={IconComponent} {size} {color} {strokeWidth} />

