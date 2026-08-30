<script lang="ts">
  import { onMount } from 'svelte';
  import type { Node } from '@/nodes/Node';
  import type { InputPort, Prop, OutputPort } from '@/types/node.types';
  import type { Graph, CanvasAnnotation } from '@/nodes/Graph';
  import type { Annotation } from '@/nodes/annotations/Annotation';
  import { inferPropControlType } from '@/utils/propUtils';
  import PortEditor from './components/PortEditor.svelte';
  import NumberInput from './components/NumberInput.svelte';
  import VectorInput from './components/VectorInput.svelte';
  import ColorPicker from './components/ColorPicker.svelte';
  import FileInput from './components/FileInput.svelte';
  import SelectInput from './components/SelectInput.svelte';
  import ButtonInput from './components/ButtonInput.svelte';
  import CheckboxInput from './components/CheckboxInput.svelte';
  import FolderGroup from './components/FolderGroup.svelte';
  import ColorRampEditor from './components/ColorRampEditor.svelte';
  import ExpressionInput from './components/ExpressionInput.svelte';
  import { propUpdateCounters } from './stores/propUpdateStore';
  import { normalizeColor, colorToHex } from '@/utils/colorUtils';
  import { setStudioParameter } from './StudioParameterController';

  export let node: Node | null = null;
  export let annotation: CanvasAnnotation | null = null;
  export let graph: Graph | null = null;
  export let position: 'right' | 'left' = 'right';
  export let skipAnimation: boolean = false;
  export let onRecordHistory: (() => void) | undefined = undefined;
  export let onAction: ((action: string, nodeId: string) => void) | undefined = undefined;

  // Track if history was recorded for current editing session
  let historyRecordedForCurrentEdit = false;

  // Record history once at the start of an edit session
  function maybeRecordHistory() {
    if (!historyRecordedForCurrentEdit && onRecordHistory) {
      onRecordHistory();
      historyRecordedForCurrentEdit = true;
    }
  }

  // Reset the flag when mouse is released (end of drag) or on blur
  function resetHistoryTracking() {
    historyRecordedForCurrentEdit = false;
  }

  // Listen for mouseup to reset history tracking after drag operations
  onMount(() => {
    const handleMouseUp = () => resetHistoryTracking();
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  });
  
  /**
   * Ports are created and filled by the node's own code, outside anything
   * Svelte watches — `node.outputs` is pushed to during execute, and a cook
   * replaces output VALUES without any assignment the compiler can see. So the
   * panel showed a node's inputs (which exist from load) and no outputs at all,
   * and never refreshed a value after a re-cook.
   *
   * A small tick while a node is selected is the honest fix: it reads the
   * node's own cook counter and port counts, and bumps a version only when one
   * of them actually moved, so a still graph costs nothing.
   */
  let portsVersion = 0;
  let portsFingerprint = '';

  /**
   * Collapsed by default, and remembered per node.
   *
   * A node like density-blend has twenty-one inputs, so an always-open panel
   * means scrolling past a wall of parameters to reach the one you came for.
   * Per node rather than globally, because which half you care about depends
   * entirely on the node — a source node is all outputs, a blend is all inputs.
   * Session-scoped: it is a working preference, not something to write into the
   * graph file.
   */
  const sectionState = new Map<string, { inputs: boolean; params: boolean; outputs: boolean }>();
  let sectionVersion = 0;

  function sectionsFor(id: string) {
    // Parameters open by default: they are the node's controls, and the reason
    // to select a node is usually to change one. Pins stay shut — they are
    // structure, and the graph already shows them.
    if (!sectionState.has(id)) sectionState.set(id, { inputs: false, params: true, outputs: false });
    return sectionState.get(id)!;
  }

  function toggleSection(id: string, which: 'inputs' | 'params' | 'outputs') {
    const state = sectionsFor(id);
    state[which] = !state[which];
    sectionVersion += 1;
  }

  function currentSections(version: number) {
    void version;
    return node ? sectionsFor(node.id) : { inputs: false, params: true, outputs: false };
  }

  $: openSections = currentSections(sectionVersion);

  onMount(() => {
    const timer = setInterval(() => {
      if (!node) return;
      const next = `${node.id}:${node.cookInfo?.cookCount ?? 0}:${node.inputs?.length ?? 0}:${node.outputs?.length ?? 0}`;
      if (next !== portsFingerprint) {
        portsFingerprint = next;
        portsVersion += 1;
      }
    }, 400);
    return () => clearInterval(timer);
  });

  function currentPorts<T>(version: number, ports: T[] | undefined): T[] {
    void version;
    return ports ?? [];
  }

  $: inputs = currentPorts(portsVersion, node?.inputs);
  $: outputs = currentPorts(portsVersion, node?.outputs);

  /**
   * Every input port, editable when nothing is connected to it.
   *
   * A node declares its parameters with `node.in(name, default)`, which makes
   * them input ports — so a panel that only read `node.props` had nothing to
   * show for any real node. Unconnected ports ARE the parameters; connected ones
   * are shown read-only, because typing over a value the next cook will
   * overwrite is worse than not offering the field.
   */
  /**
   * Real input pins only — a promoted parameter is shown in the Parameters
   * section, where it belongs, rather than twice.
   */
  $: portParams = inputs.filter((p: any) => !p.fromParameter);

  /** The node's own values. Dependent ones (`visibleWhen`) drop out until the
   *  parameter they depend on is set. */
  function currentParameters(version: number) {
    void version;
    return (node?.parameters ?? []).filter((p: any) => {
    if (typeof p.options?.visibleWhen !== 'function') return true;
    try {
      const current = Object.fromEntries((node?.parameters ?? []).map((q: any) => [q.name, q.value]));
      return p.options.visibleWhen(current);
    } catch {
      return true;
    }
    });
  }

  $: parameters = currentParameters(portsVersion);

  // Kept for the older props-based path below.
  $: paramInputs = [];
  // Track props keys explicitly to ensure reactivity when props are added
  // Use a computed that depends on both node and the props object reference
  $: propsKeys = node ? Object.keys(node.props) : [];
  $: propsCount = node ? Object.keys(node.props).length : 0;
  // CRITICAL: Watch node.props directly to detect when it's recreated
  // This ensures Svelte detects changes when updateProp recreates the props object
  $: nodeProps = node?.props;
  // Watch the prop update counter store to detect when props are updated
  let propsUpdateCounter = 0;
  $: {
    const counters = $propUpdateCounters;
    propsUpdateCounter = node ? (counters.get(node.id) || 0) : 0;
  }
  // Create a stringified version of all prop values AND params to force reactivity when either change
  // CRITICAL: Include propsUpdateCounter in the calculation to force recalculation when props update
  $: propsValueKey = (nodeProps && propsUpdateCounter >= 0) ? Object.entries(nodeProps).map(([k, p]) => `${k}:${JSON.stringify(p.value)}:${JSON.stringify(p.params)}`).join('|') + `|counter:${propsUpdateCounter}` : '';
  // Make props reactive to nodeProps, propsCount, propsValueKey, and propsUpdateCounter to ensure updates are detected
  let props: Array<[string, Prop]> = [];
  $: {
    // Force recalculation by accessing nodeProps fresh each time
    const currentProps = node?.props;
    const newProps = (currentProps && propsCount >= 0 && propsValueKey !== undefined) ? Object.entries(currentProps).filter(([_, prop]) => {
      if (typeof prop.hidden === 'function') {
        return !prop.hidden();
      }
      return !prop.hidden;
    }) : [];
    props = newProps;
  }
  
  function handleInputChange(port: InputPort, value: any) {
    port.value = value;
    if (port.onChange) {
      port.onChange(value);
    }
  }
  
  function handleNumberInput(port: InputPort, e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    handleInputChange(port, value);
  }
  
  function handleTextInput(port: InputPort, e: Event) {
    const value = (e.target as HTMLInputElement).value;
    handleInputChange(port, value);
  }
  
  function handleTextareaInput(port: InputPort, e: Event) {
    const value = (e.target as HTMLTextAreaElement).value;
    handleInputChange(port, value);
  }
  
  function handleCheckboxChange(port: InputPort, e: Event) {
    const value = (e.target as HTMLInputElement).checked;
    handleInputChange(port, value);
  }
  
  function handleTriggerClick(port: InputPort) {
    if (port.onTrigger) {
      port.onTrigger();
    }
  }
  
  /** Set an unconnected input. Dirty propagation and coalesced cooking are
   * owned by the graph scheduler. */
  function handlePortChange(port: any, value: any) {
    if (!node) return;
    maybeRecordHistory();
    port.value = value;
    if (port.onChange) {
      try { port.onChange(value); } catch (err) { console.warn('port onChange failed:', err); }
    }
    node.markDirty?.();
  }

  function handleParamChange(parameter: any, value: any) {
    if (!node) return;
    setStudioParameter(node, parameter.name, value, maybeRecordHistory);
    // Deliberately no re-key here. Rebuilding the row on every commit destroys
    // the control being used — a slider drag lost focus after one step, because
    // the element under the pointer was replaced between events. The value is
    // already on the parameter; the input owns its own display until something
    // outside the panel changes it.
  }

  function handleParameterAction(parameter: any) {
    if (node && parameter.options?.action) onAction?.(parameter.options.action, node.id);
  }

  /** Promote a parameter to an input pin, or demote it back. */
  function togglePromoted(parameter: any) {
    if (!node) return;
    maybeRecordHistory();
    node.setParameterPromoted(parameter.name, !parameter.promoted);
    if (graph) graph.elements = [...graph.elements];
    sectionVersion += 1;
    portsVersion += 1;
  }

  function handlePropChange([key, prop]: [string, Prop], value: any) {
    if (node) {
      maybeRecordHistory();
      node.updateProp(key, value);
    }
  }
  
  function handlePropNumberInput([key, prop]: [string, Prop], e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    handlePropChange([key, prop], value);
  }
  
  function handlePropTextInput([key, prop]: [string, Prop], e: Event) {
    const value = (e.target as HTMLInputElement).value;
    handlePropChange([key, prop], value);
  }
  
  function handlePropTextareaInput([key, prop]: [string, Prop], e: Event) {
    const value = (e.target as HTMLTextAreaElement).value;
    handlePropChange([key, prop], value);
  }
  
  function handlePropCheckboxChange([key, prop]: [string, Prop], e: Event) {
    const value = (e.target as HTMLInputElement).checked;
    handlePropChange([key, prop], value);
  }
  
  function handlePropSelectChange([key, prop]: [string, Prop], e: Event) {
    const selectedValue = (e.target as HTMLSelectElement).value;
    // Find the original option value (could be object or primitive)
    const option = prop.params?.options?.find(opt => {
      const optValue = typeof opt === 'object' && 'value' in opt ? opt.value : opt;
      return String(optValue) === selectedValue;
    });
    const finalValue = option && typeof option === 'object' && 'value' in option ? option.value : selectedValue;
    handlePropChange([key, prop], finalValue);
  }
  
  function renderPropControl([key, prop]: [string, Prop]): { key: string; prop: Prop; controlType: ReturnType<typeof inferPropControlType>; displayName: string; folder: string | undefined } | null {
    const controlType = inferPropControlType(prop);
    const displayName = prop.displayName || key;
    const isDisabled = typeof prop.disabled === 'function' ? prop.disabled() : prop.disabled;
    
    if (isDisabled) {
      return null;
    }
    
    // Group by folder if specified
    const folder = prop.folder;
    
    return { key, prop, controlType, displayName, folder };
  }
  
  type PropControlItem = { key: string; prop: Prop; controlType: ReturnType<typeof inferPropControlType>; displayName: string; folder: string | undefined };
  
  $: propControls = props.map(renderPropControl).filter((item): item is PropControlItem => item !== null);
  $: groupedProps = propControls.reduce((acc, item) => {
    const folder = item.folder || 'General';
    if (!acc[folder]) {
      acc[folder] = [];
    }
    acc[folder].push(item);
    return acc;
  }, {} as Record<string, PropControlItem[]>);
  
  // Folder expansion state
  let folderExpanded: Record<string, boolean> = {};
  
  function toggleFolder(folder: string) {
    folderExpanded[folder] = !folderExpanded[folder];
    folderExpanded = { ...folderExpanded }; // Trigger reactivity
  }
  
  $: {
    // Initialize folder expansion state
    // Settings folder is collapsed by default, others are expanded
    Object.keys(groupedProps).forEach(folder => {
      if (!(folder in folderExpanded)) {
        folderExpanded[folder] = folder !== 'Settings';
      }
    });
  }
  
  // Annotation styling handlers
  function handleAnnotationStyleChange(styleKey: string, value: any) {
    if (annotation && graph) {
      // Create a new style object directly without mutating the original
      const newStyle = {
        ...(annotation.style || {}),
        [styleKey]: value
      };
      // Update annotation instance directly, then trigger reactivity
      const ann = graph.getAnnotation(annotation.id);
      if (ann) {
        ann.style = newStyle;
        // Trigger reactivity by reassigning annotations array
        graph.annotations = [...graph.annotations];
      }
    }
  }
  
  function handleAnnotationSizeChange(sizeKey: 'width' | 'height', value: number) {
    if (annotation && graph) {
      const ann = graph.getAnnotation(annotation.id);
      if (ann) {
        if (!ann.size) {
          ann.size = { width: 540, height: 60 };
        }
        ann.size[sizeKey] = value;
        // Trigger reactivity
        graph.annotations = [...graph.annotations];
      }
    }
  }
  
  function handleAnnotationContentChange(value: string) {
    if (annotation && graph) {
      const ann = graph.getAnnotation(annotation.id);
      if (ann && ann.type === 'text') {
        (ann as any).content = value;
        // Trigger reactivity
        graph.annotations = [...graph.annotations];
        // Update the annotation reference
        (annotation as any).content = value;
      }
    }
  }
  
  function handleAnnotationContentInput(e: Event) {
    const value = (e.target as HTMLTextAreaElement).value;
    handleAnnotationContentChange(value);
  }
  
  function handleAnnotationStyleNumberInput(styleKey: string, e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    handleAnnotationStyleChange(styleKey, value);
  }
  
  function handleAnnotationStyleTextInput(styleKey: string, e: Event) {
    const value = (e.target as HTMLInputElement).value;
    handleAnnotationStyleChange(styleKey, value);
  }
  
  function handleAnnotationStyleColorInput(styleKey: string, e: Event) {
    const value = (e.target as HTMLInputElement).value;
    handleAnnotationStyleChange(styleKey, value);
  }
  
  function handleAnnotationStyleSelectChange(styleKey: string, e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    handleAnnotationStyleChange(styleKey, value);
  }
  
  function handleAnnotationSizeInput(sizeKey: 'width' | 'height', e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    handleAnnotationSizeChange(sizeKey, value);
  }
  
  function handleAnnotationPositionXInput(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value) && annotation && graph) {
      const ann = graph.getAnnotation(annotation.id);
      if (ann) {
        ann.position.x = value;
        graph.annotations = [...graph.annotations];
      }
    }
  }
  
  function handleAnnotationPositionYInput(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value) && annotation && graph) {
      const ann = graph.getAnnotation(annotation.id);
      if (ann) {
        ann.position.y = value;
        graph.annotations = [...graph.annotations];
      }
    }
  }
  
  function handleAnnotationEndPositionXInput(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value) && annotation && graph) {
      const ann = graph.getAnnotation(annotation.id);
      if (ann && ann.type === 'line') {
        if (!(ann as any).endPosition) {
          (ann as any).endPosition = { ...ann.position };
        }
        (ann as any).endPosition.x = value;
        graph.annotations = [...graph.annotations];
        if ((annotation as any).endPosition) {
          (annotation as any).endPosition.x = value;
        } else {
          (annotation as any).endPosition = { ...annotation.position, x: value };
        }
      }
    }
  }
  
  function handleAnnotationEndPositionYInput(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value) && annotation && graph) {
      const ann = graph.getAnnotation(annotation.id);
      if (ann && ann.type === 'line') {
        if (!(ann as any).endPosition) {
          (ann as any).endPosition = { ...ann.position };
        }
        (ann as any).endPosition.y = value;
        graph.annotations = [...graph.annotations];
        if ((annotation as any).endPosition) {
          (annotation as any).endPosition.y = value;
        } else {
          (annotation as any).endPosition = { ...annotation.position, y: value };
        }
      }
    }
  }
  
  function handleAnnotationColorHexInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      handleAnnotationStyleChange('color', value);
    }
  }
  
  function handleAnnotationStrokeColorHexInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      handleAnnotationStyleChange('strokeColor', value);
    }
  }
  
  // Handler for VectorInput position changes
  function handleAnnotationPositionChange(value: number[]) {
    if (annotation && graph && value.length >= 2) {
      const ann = graph.getAnnotation(annotation.id);
      if (ann) {
        ann.position = { x: value[0], y: value[1] };
        graph.annotations = [...graph.annotations];
      }
    }
  }
  
  // Handler for ColorPicker text color changes
  function handleAnnotationTextColorChange(color: any) {
    if (annotation && graph) {
      // ColorPicker returns ColorObject, convert to hex string for annotation style
      const colorObj = normalizeColor(color);
      const hexValue = colorToHex(colorObj);
      handleAnnotationStyleChange('color', hexValue);
    }
  }
  
  // Handler for ColorPicker background color changes
  function handleAnnotationBackgroundColorChange(color: any) {
    if (annotation && graph) {
      // ColorPicker returns ColorObject, convert to hex string for annotation style
      const colorObj = normalizeColor(color);
      const hexValue = colorToHex(colorObj);
      handleAnnotationStyleChange('backgroundColor', hexValue);
    }
  }
  
  // Helper function to adjust number input value
  function adjustNumberInput(inputId: string, delta: number, min?: number, max?: number, step: number = 1) {
    const input = document.getElementById(inputId) as HTMLInputElement;
    if (!input) return;
    
    let currentValue = parseFloat(input.value) || 0;
    let newValue = currentValue + (delta * step);
    
    if (min !== undefined && newValue < min) newValue = min;
    if (max !== undefined && newValue > max) newValue = max;
    
    input.value = String(newValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  
  // Mousewheel handler for number inputs
  function handleNumberInputWheel(e: WheelEvent, min?: number, max?: number, step: number = 1) {
    e.preventDefault();
    const input = e.target as HTMLInputElement;
    const delta = e.deltaY > 0 ? -1 : 1;
    adjustNumberInput(input.id, delta, min, max, step);
  }
</script>

{#if annotation && annotation.type === 'text'}
  <div class="inspector" class:left={position === 'left'} class:no-animation={skipAnimation}>
    <div class="content">
      <!-- Content -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Content</span>
        </div>
        <textarea
          id="annotation-content"
          class="content-textarea"
          value={annotation.content || ''}
          on:input={handleAnnotationContentInput}
          placeholder="Enter text..."
        ></textarea>
      </div>
      
      <!-- Position -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Position</span>
        </div>
        {#key `position-${annotation.id}-${annotation.position.x}-${annotation.position.y}`}
          <VectorInput
            prop={{
              value: [annotation.position.x, annotation.position.y],
              type: 'vec2',
              params: { integer: true }
            }}
            id="annotation-position"
            onValueChange={handleAnnotationPositionChange}
          />
        {/key}
      </div>
      
      <!-- Layout -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Layout</span>
        </div>
        <div class="layout-grid">
          <div class="layout-input-group">
            <label class="layout-label" for="annotation-width">W</label>
            <div class="number-input-with-buttons">
              <input
                id="annotation-width"
                type="number"
                class="layout-input"
                min="100"
                value={annotation.size?.width || 540}
                on:input={(e) => handleAnnotationSizeInput('width', e)}
                on:wheel={(e) => handleNumberInputWheel(e, 100, undefined, 10)}
              />
              <button
                class="number-button decrement"
                on:click={() => adjustNumberInput('annotation-width', -1, 100)}
                type="button"
                title="Decrease"
              >−</button>
              <button
                class="number-button increment"
                on:click={() => adjustNumberInput('annotation-width', 1, 100)}
                type="button"
                title="Increase"
              >+</button>
            </div>
          </div>
          <div class="layout-input-group">
            <label class="layout-label" for="annotation-height">H</label>
            <div class="number-input-with-buttons">
              <input
                id="annotation-height"
                type="number"
                class="layout-input"
                min="20"
                value={annotation.size?.height || 60}
                on:input={(e) => handleAnnotationSizeInput('height', e)}
                on:wheel={(e) => handleNumberInputWheel(e, 20, undefined, 10)}
              />
              <button
                class="number-button decrement"
                on:click={() => adjustNumberInput('annotation-height', -1, 20)}
                type="button"
                title="Decrease"
              >−</button>
              <button
                class="number-button increment"
                on:click={() => adjustNumberInput('annotation-height', 1, 20)}
                type="button"
                title="Increase"
              >+</button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Typography -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Typography</span>
        </div>
        
        <!-- Size Presets -->
        <div class="typography-presets">
          <button
            class="preset-button"
            class:active={(annotation.style?.fontSize || 14) === 32 && (annotation.style?.fontWeight || 'normal') === 'bold'}
            on:click={() => {
              handleAnnotationStyleChange('fontSize', 32);
              handleAnnotationStyleChange('fontWeight', 'bold');
            }}
            title="Heading 1"
          >
            H1
          </button>
          <button
            class="preset-button"
            class:active={(annotation.style?.fontSize || 14) === 24 && (annotation.style?.fontWeight || 'normal') === 'bold'}
            on:click={() => {
              handleAnnotationStyleChange('fontSize', 24);
              handleAnnotationStyleChange('fontWeight', 'bold');
            }}
            title="Heading 2"
          >
            H2
          </button>
          <button
            class="preset-button"
            class:active={(annotation.style?.fontSize || 14) === 18 && (annotation.style?.fontWeight || 'normal') === 'bold'}
            on:click={() => {
              handleAnnotationStyleChange('fontSize', 18);
              handleAnnotationStyleChange('fontWeight', 'bold');
            }}
            title="Heading 3"
          >
            H3
          </button>
          <button
            class="preset-button"
            class:active={(annotation.style?.fontSize || 14) === 14 && (annotation.style?.fontWeight || 'normal') === 'normal'}
            on:click={() => {
              handleAnnotationStyleChange('fontSize', 14);
              handleAnnotationStyleChange('fontWeight', 'normal');
            }}
            title="Text"
          >
            Text
          </button>
        </div>
        
        <div class="typography-row">
          <div class="typography-input-group">
            <label class="typography-label" for="annotation-font-size">Size</label>
            <div class="number-input-with-buttons">
              <input
                id="annotation-font-size"
                type="number"
                class="typography-number-input"
                min="8"
                max="72"
                step="1"
                value={annotation.style?.fontSize || 14}
                on:input={(e) => handleAnnotationStyleNumberInput('fontSize', e)}
                on:wheel={(e) => handleNumberInputWheel(e, 8, 72, 1)}
              />
              <button
                class="number-button decrement"
                on:click={() => adjustNumberInput('annotation-font-size', -1, 8, 72, 1)}
                type="button"
                title="Decrease"
              >−</button>
              <button
                class="number-button increment"
                on:click={() => adjustNumberInput('annotation-font-size', 1, 8, 72, 1)}
                type="button"
                title="Increase"
              >+</button>
            </div>
          </div>
          
          <div class="typography-input-group">
            <label class="typography-label" for="annotation-text-align">Align</label>
            <div class="align-buttons">
              <button
                class="align-button"
                class:active={annotation.style?.textAlign === 'left' || !annotation.style?.textAlign}
                on:click={() => handleAnnotationStyleChange('textAlign', 'left')}
                title="Align left"
                aria-label="Align left"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M2 3H12M2 7H10M2 11H12" stroke-linecap="round"/>
                </svg>
              </button>
              <button
                class="align-button"
                class:active={annotation.style?.textAlign === 'center'}
                on:click={() => handleAnnotationStyleChange('textAlign', 'center')}
                title="Align center"
                aria-label="Align center"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M2 3H12M4 7H10M2 11H12" stroke-linecap="round"/>
                </svg>
              </button>
              <button
                class="align-button"
                class:active={annotation.style?.textAlign === 'right'}
                on:click={() => handleAnnotationStyleChange('textAlign', 'right')}
                title="Align right"
                aria-label="Align right"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M2 3H12M4 7H12M2 11H12" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        
        <!-- Style Toggle Buttons -->
        <div class="typography-toggles">
          <button
            class="toggle-button"
            class:active={(annotation.style?.fontWeight || 'normal') === 'bold'}
            on:click={() => {
              const currentWeight = annotation.style?.fontWeight || 'normal';
              handleAnnotationStyleChange('fontWeight', currentWeight === 'bold' ? 'normal' : 'bold');
            }}
            title="Bold"
          >
            <strong>B</strong>
          </button>
          <button
            class="toggle-button"
            class:active={(annotation.style?.fontStyle || 'normal') === 'italic'}
            on:click={() => {
              const currentStyle = annotation.style?.fontStyle || 'normal';
              handleAnnotationStyleChange('fontStyle', currentStyle === 'italic' ? 'normal' : 'italic');
            }}
            title="Italic"
          >
            <em>I</em>
          </button>
          <button
            class="toggle-button"
            class:active={(annotation.style?.fontWeight || 'normal') === 'normal' && (annotation.style?.fontStyle || 'normal') === 'normal'}
            on:click={() => {
              handleAnnotationStyleChange('fontWeight', 'normal');
              handleAnnotationStyleChange('fontStyle', 'normal');
            }}
            title="Normal"
          >
            N
          </button>
        </div>
      </div>
      
      <!-- Text Color -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Text Color</span>
        </div>
        {#key `text-color-${annotation.id}-${annotation.style?.color || '#ffffff'}`}
          <ColorPicker
            prop={{
              value: annotation.style?.color || '#ffffff',
              type: 'color'
            }}
            id="annotation-text-color"
            onValueChange={handleAnnotationTextColorChange}
          />
        {/key}
      </div>
      
      <!-- Appearance -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Appearance</span>
        </div>
        
        <div class="appearance-row">
          <div class="appearance-input-group">
            <label class="appearance-label" for="annotation-border-radius">Radius</label>
            <div class="number-input-with-buttons">
              <input
                id="annotation-border-radius"
                type="number"
                class="appearance-number-input"
                min="0"
                max="16"
                step="1"
                value={annotation.style?.borderRadius || 4}
                on:input={(e) => handleAnnotationStyleNumberInput('borderRadius', e)}
                on:wheel={(e) => handleNumberInputWheel(e, 0, 16, 1)}
              />
              <button
                class="number-button decrement"
                on:click={() => adjustNumberInput('annotation-border-radius', -1, 0, 16, 1)}
                type="button"
                title="Decrease"
              >−</button>
              <button
                class="number-button increment"
                on:click={() => adjustNumberInput('annotation-border-radius', 1, 0, 16, 1)}
                type="button"
                title="Increase"
              >+</button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Background Color -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Background Color</span>
        </div>
        {#key `bg-color-${annotation.id}-${annotation.style?.backgroundColor || '#000000'}`}
          <ColorPicker
            prop={{
              value: annotation.style?.backgroundColor || '#000000',
              type: 'color'
            }}
            id="annotation-bg-color"
            onValueChange={handleAnnotationBackgroundColorChange}
          />
        {/key}
      </div>
    </div>
  </div>
{:else if annotation && annotation.type === 'line'}
  <div class="inspector" class:left={position === 'left'} class:no-animation={skipAnimation}>
    <div class="content">
      <!-- Position -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Position</span>
        </div>
        <div class="position-grid">
          <div class="position-input-group">
            <label class="position-label" for="annotation-x">X</label>
            <input
              id="annotation-x"
              type="number"
              class="position-input"
              value={Math.round(annotation.position.x)}
              on:input={handleAnnotationPositionXInput}
            />
          </div>
          <div class="position-input-group">
            <label class="position-label" for="annotation-y">Y</label>
            <input
              id="annotation-y"
              type="number"
              class="position-input"
              value={Math.round(annotation.position.y)}
              on:input={handleAnnotationPositionYInput}
            />
          </div>
        </div>
      </div>
      
      <!-- End Position -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">End Position</span>
        </div>
        <div class="position-grid">
          <div class="position-input-group">
            <label class="position-label" for="annotation-end-x">X</label>
            <input
              id="annotation-end-x"
              type="number"
              class="position-input"
              value={Math.round(annotation.endPosition?.x || annotation.position.x)}
              on:input={handleAnnotationEndPositionXInput}
            />
          </div>
          <div class="position-input-group">
            <label class="position-label" for="annotation-end-y">Y</label>
            <input
              id="annotation-end-y"
              type="number"
              class="position-input"
              value={Math.round(annotation.endPosition?.y || annotation.position.y)}
              on:input={handleAnnotationEndPositionYInput}
            />
          </div>
        </div>
      </div>
      
      <!-- Stroke -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Stroke</span>
        </div>
        <div class="fill-controls">
          <input
            id="annotation-stroke-color"
            type="color"
            class="color-picker"
            value={annotation.style?.strokeColor || '#ffffff'}
            on:input={(e) => handleAnnotationStyleColorInput('strokeColor', e)}
          />
          <input
            id="annotation-stroke-color-hex"
            type="text"
            class="color-hex-input"
            value={(annotation.style?.strokeColor || '#ffffff').toUpperCase()}
            on:input={handleAnnotationStrokeColorHexInput}
            placeholder="#FFFFFF"
          />
        </div>
        <div class="appearance-row" style="margin-top: 8px;">
          <div class="appearance-input-group">
            <label class="appearance-label" for="annotation-stroke-width">Width</label>
            <div class="number-input-with-buttons">
              <input
                id="annotation-stroke-width"
                type="number"
                class="appearance-number-input"
                min="1"
                max="20"
                step="1"
                value={annotation.style?.strokeWidth || 2}
                on:input={(e) => handleAnnotationStyleNumberInput('strokeWidth', e)}
                on:wheel={(e) => handleNumberInputWheel(e, 1, 20, 1)}
              />
              <button
                class="number-button decrement"
                on:click={() => adjustNumberInput('annotation-stroke-width', -1, 1, 20, 1)}
                type="button"
                title="Decrease"
              >−</button>
              <button
                class="number-button increment"
                on:click={() => adjustNumberInput('annotation-stroke-width', 1, 1, 20, 1)}
                type="button"
                title="Increase"
              >+</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
{:else if annotation && annotation.type === 'polyline'}
  <div class="inspector" class:left={position === 'left'} class:no-animation={skipAnimation}>
    <div class="content">
      <!-- Position -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Position</span>
        </div>
        <div class="position-grid">
          <div class="position-input-group">
            <label class="position-label" for="annotation-x">X</label>
            <input
              id="annotation-x"
              type="number"
              class="position-input"
              value={Math.round(annotation.position.x)}
              on:input={handleAnnotationPositionXInput}
            />
          </div>
          <div class="position-input-group">
            <label class="position-label" for="annotation-y">Y</label>
            <input
              id="annotation-y"
              type="number"
              class="position-input"
              value={Math.round(annotation.position.y)}
              on:input={handleAnnotationPositionYInput}
            />
          </div>
        </div>
      </div>
      
      <!-- Stroke -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Stroke</span>
        </div>
        <div class="fill-controls">
          <input
            id="annotation-stroke-color"
            type="color"
            class="color-picker"
            value={annotation.style?.strokeColor || '#ffffff'}
            on:input={(e) => handleAnnotationStyleColorInput('strokeColor', e)}
          />
          <input
            id="annotation-stroke-color-hex"
            type="text"
            class="color-hex-input"
            value={(annotation.style?.strokeColor || '#ffffff').toUpperCase()}
            on:input={handleAnnotationStrokeColorHexInput}
            placeholder="#FFFFFF"
          />
        </div>
        <div class="appearance-row" style="margin-top: 8px;">
          <div class="appearance-input-group">
            <label class="appearance-label" for="annotation-stroke-width">Width</label>
            <div class="number-input-with-buttons">
              <input
                id="annotation-stroke-width"
                type="number"
                class="appearance-number-input"
                min="1"
                max="20"
                step="1"
                value={annotation.style?.strokeWidth || 2}
                on:input={(e) => handleAnnotationStyleNumberInput('strokeWidth', e)}
                on:wheel={(e) => handleNumberInputWheel(e, 1, 20, 1)}
              />
              <button
                class="number-button decrement"
                on:click={() => adjustNumberInput('annotation-stroke-width', -1, 1, 20, 1)}
                type="button"
                title="Decrease"
              >−</button>
              <button
                class="number-button increment"
                on:click={() => adjustNumberInput('annotation-stroke-width', 1, 1, 20, 1)}
                type="button"
                title="Increase"
              >+</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
{:else if node}
  <div class="inspector" class:left={position === 'left'} class:no-animation={skipAnimation}>
    <div class="content">
      {#if node.error}
        <div class="error-badge-container">
          <span class="error-badge">Error</span>
        </div>
      {/if}
      <!-- Props -->
      {#if propControls.length > 0}
        {#each Object.entries(groupedProps) as entry}
          {@const [folder, folderProps] = entry}
          {#if folder !== 'General'}
            <FolderGroup
              folderName={folder}
              isExpanded={folderExpanded[folder] ?? true}
              on:toggle={() => toggleFolder(folder)}
            >
              {#each folderProps as item}
                {@const { key, prop, controlType, displayName } = item}
                {@const inputId = `prop-${key}-${folder}`}
                {@const isVector = controlType === 'vec2' || controlType === 'vec3' || controlType === 'vec2i' || controlType === 'vec3i' || controlType === 'vector'}
                <div class="prop-group" class:prop-group-row={isVector}>
                  {#if displayName !== null}
                    <label class="prop-label" for={inputId}>
                      {displayName}
                    </label>
                  {/if}
                  
                  {#if controlType === 'number' || controlType === 'slider' || controlType === 'int'}
                    {#key `${key}-${prop.value}-${prop.expression}-${JSON.stringify(prop.params)}`}
                      <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                        <NumberInput
                          {prop}
                          id={inputId}
                          onValueChange={(value) => handlePropChange([key, prop], value)}
                        />
                      </ExpressionInput>
                    {/key}
                  {:else if isVector}
                    {#key `${key}-${JSON.stringify(prop.value)}-${prop.expression}-${propsValueKey}-${propsUpdateCounter}`}
                      <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                        <VectorInput
                          {prop}
                          id={inputId}
                          onValueChange={(value) => handlePropChange([key, prop], value)}
                        />
                      </ExpressionInput>
                    {/key}
                  {:else if controlType === 'color'}
                    {#key `${key}-${JSON.stringify(prop.value)}-${prop.expression}`}
                      <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                        <ColorPicker
                          {prop}
                          id={inputId}
                          onValueChange={(value) => handlePropChange([key, prop], value)}
                        />
                      </ExpressionInput>
                    {/key}
                  {:else if controlType === 'colorramp'}
                    <ColorRampEditor
                      {prop}
                      id={inputId}
                      onValueChange={(value) => handlePropChange([key, prop], value)}
                    />
                  {:else if controlType === 'image' || (controlType === 'text' && prop.params?.accept)}
                    <FileInput
                      {prop}
                      id={inputId}
                      onValueChange={(value) => handlePropChange([key, prop], value)}
                    />
                  {:else if controlType === 'text' || controlType === 'textarea'}
                    {#key `${key}-${prop.expression}`}
                      <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                        {#if controlType === 'textarea'}
                          <textarea
                            id={inputId}
                            class="param-textarea"
                            value={prop.value || ''}
                            on:input={(e) => handlePropTextareaInput([key, prop], e)}
                          ></textarea>
                        {:else}
                          <input
                            id={inputId}
                            type="text"
                            class="param-input"
                            value={prop.value || ''}
                            on:input={(e) => handlePropTextInput([key, prop], e)}
                          />
                        {/if}
                      </ExpressionInput>
                    {/key}
                  {:else if controlType === 'boolean'}
                    {#key `${key}-${prop.value}-${prop.expression}`}
                      <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                        <CheckboxInput
                          {prop}
                          id={inputId}
                          onValueChange={(value) => handlePropChange([key, prop], value)}
                        />
                      </ExpressionInput>
                    {/key}
                  {:else if controlType === 'select' && prop.params?.options}
                    {#key `${key}-${prop.value}-${prop.expression}`}
                      <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                        <SelectInput
                          {prop}
                          id={inputId}
                          onValueChange={(value) => handlePropChange([key, prop], value)}
                        />
                      </ExpressionInput>
                    {/key}
                  {:else if controlType === 'button'}
                    <ButtonInput
                      {prop}
                      id={inputId}
                      onValueChange={() => {
                        if (typeof prop.value === 'function') {
                          prop.value();
                        }
                        // Also call onChange if defined
                        if (typeof prop.onChange === 'function') {
                          // onChange's declared signature is (prop, context) — pass
                          // the prop itself plus `true` as the click-activation
                          // context, rather than passing `true` where a Prop was
                          // expected.
                          prop.onChange(prop, true);
                        }
                      }}
                    />
                  {:else}
                    <input
                      id={inputId}
                      type="text"
                      class="param-input"
                      value={String(prop.value || '')}
                      on:input={(e) => handlePropTextInput([key, prop], e)}
                    />
                  {/if}
                </div>
              {/each}
            </FolderGroup>
          {:else}
            {#each folderProps as item}
              {@const { key, prop, controlType, displayName } = item}
              {@const inputId = `prop-${key}-${folder}`}
              {@const isVector = controlType === 'vec2' || controlType === 'vec3' || controlType === 'vec2i' || controlType === 'vec3i' || controlType === 'vector'}
              <div class="prop-group" class:prop-group-row={isVector}>
                {#if displayName !== null}
                  <label class="prop-label" for={inputId}>
                    {displayName}
                  </label>
                {/if}
                
                {#if controlType === 'number' || controlType === 'slider' || controlType === 'int'}
                  <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                    <NumberInput
                      {prop}
                      id={inputId}
                      onValueChange={(value) => handlePropChange([key, prop], value)}
                    />
                  </ExpressionInput>
                {:else if isVector}
                  {#key `${key}-${JSON.stringify(prop.value)}-${prop.expression}-${propsValueKey}-${propsUpdateCounter}`}
                    <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                      <VectorInput
                        {prop}
                        id={inputId}
                        onValueChange={(value) => handlePropChange([key, prop], value)}
                      />
                    </ExpressionInput>
                  {/key}
                {:else if controlType === 'color'}
                  {#key `${key}-${JSON.stringify(prop.value)}-${prop.expression}`}
                    <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                      <ColorPicker
                        {prop}
                        id={inputId}
                        onValueChange={(value) => handlePropChange([key, prop], value)}
                      />
                    </ExpressionInput>
                  {/key}
                {:else if controlType === 'colorramp'}
                  <ColorRampEditor
                    {prop}
                    id={inputId}
                    onValueChange={(value) => handlePropChange([key, prop], value)}
                  />
                {:else if controlType === 'image' || (controlType === 'text' && prop.params?.accept)}
                  <FileInput
                    {prop}
                    id={inputId}
                    onValueChange={(value) => handlePropChange([key, prop], value)}
                  />
                {:else if controlType === 'text' || controlType === 'textarea'}
                  {#key `${key}-${prop.expression}`}
                    <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                      {#if controlType === 'textarea'}
                        <textarea
                          id={inputId}
                          class="param-textarea"
                          value={prop.value || ''}
                          on:input={(e) => handlePropTextareaInput([key, prop], e)}
                        ></textarea>
                      {:else}
                        <input
                          id={inputId}
                          type="text"
                          class="param-input"
                          value={prop.value || ''}
                          on:input={(e) => handlePropTextInput([key, prop], e)}
                        />
                      {/if}
                    </ExpressionInput>
                  {/key}
                {:else if controlType === 'boolean'}
                  {#key `${key}-${prop.value}-${prop.expression}`}
                    <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                      <CheckboxInput
                        {prop}
                        id={inputId}
                        onValueChange={(value) => handlePropChange([key, prop], value)}
                      />
                    </ExpressionInput>
                  {/key}
                {:else if controlType === 'select' && prop.params?.options}
                  {#key `${key}-${prop.value}-${prop.expression}`}
                    <ExpressionInput {prop} propKey={key} {node} onValueChange={(value) => handlePropChange([key, prop], value)}>
                      <SelectInput
                        {prop}
                        id={inputId}
                        onValueChange={(value) => handlePropChange([key, prop], value)}
                      />
                    </ExpressionInput>
                  {/key}
                {:else if controlType === 'button'}
                  <ButtonInput
                    {prop}
                    id={inputId}
                    onValueChange={() => {
                      if (typeof prop.value === 'function') {
                        prop.value();
                      }
                      // Also call onChange if defined
                      if (typeof prop.onChange === 'function') {
                        // see the other two call sites' comment — onChange's
                        // declared signature is (prop, context)
                        prop.onChange(prop, true);
                      }
                    }}
                  />
                {:else}
                  <input
                    id={inputId}
                    type="text"
                    class="param-input"
                    value={String(prop.value || '')}
                    on:input={(e) => handlePropTextInput([key, prop], e)}
                  />
                {/if}
              </div>
            {/each}
          {/if}
        {/each}
      {/if}
      
      <!-- Ports. The parameters of any node that declares them with node.in(),
           which is every project node, plus its outputs so a stage's result can
           be read without opening the viewer. -->
      {#if portParams.length > 0}
        <div class="port-section">
          <button class="port-heading" on:click={() => toggleSection(node.id, 'inputs')}>
            <span class="twisty">{openSections.inputs ? '▾' : '▸'}</span>
            Inputs
            <span class="tally">{portParams.length}</span>
          </button>
          {#if openSections.inputs}
          {#key `${node.id}-${propsUpdateCounter}-${propsValueKey}-${portsVersion}`}
            {#each portParams as port (port.id)}
              <PortEditor
                {port}
                {node}
                direction="input"
                onChange={(value) => handlePortChange(port, value)}
              />
            {/each}
          {/key}
          {/if}
        </div>
      {/if}

      <!-- Parameters: the node's own values. Between the pins, in the order the
           data actually moves — inputs, then what the node does with them, then
           outputs. -->
      {#if parameters.length > 0}
        <div class="port-section">
          <button class="port-heading" on:click={() => toggleSection(node.id, 'params')}>
            <span class="twisty">{openSections.params ? '▾' : '▸'}</span>
            Parameters
            <span class="tally">{parameters.length}</span>
          </button>
          {#if openSections.params}
            {#key node.id}
              {#each parameters as parameter (parameter.name)}
                <div class="parameter">
                  {#if parameter.options?.action}
                    <button class="parameter-action" on:click={() => handleParameterAction(parameter)}>
                      {parameter.options?.label ?? parameter.name}
                    </button>
                  {:else}
                    <PortEditor
                      port={{
                        name: parameter.options?.label ?? parameter.name,
                        dataType: parameter.dataType,
                        value: parameter.value,
                        connections: [],
                        options: parameter.options ?? {},
                      }}
                      {node}
                      direction="input"
                      onChange={(value) => handleParamChange(parameter, value)}
                    />
                  {/if}
                  {#if !parameter.options?.action && parameter.options?.promotable !== false}
                    <button
                      class="promote"
                      class:on={parameter.promoted}
                      title={parameter.promoted
                        ? 'Demote back to a parameter — removes the pin and any wire into it'
                        : 'Promote to an input pin so it can be driven from another node'}
                      on:click={() => togglePromoted(parameter)}
                    >{parameter.promoted ? 'pin ✓' : 'pin'}</button>
                  {/if}
                </div>
              {/each}
            {/key}
          {/if}
        </div>
      {/if}

      {#if outputs.length > 0}
        <div class="port-section">
          <button class="port-heading" on:click={() => toggleSection(node.id, 'outputs')}>
            <span class="twisty">{openSections.outputs ? '▾' : '▸'}</span>
            Outputs
            <span class="tally">{outputs.length}</span>
          </button>
          {#if openSections.outputs}
          {#key `${node.id}-${propsUpdateCounter}-${propsValueKey}-${portsVersion}`}
            {#each outputs as port (port.id)}
              <PortEditor
                {port}
                {node}
                direction="output"
                onChange={undefined}
              />
            {/each}
          {/key}
          {/if}
        </div>
      {/if}

      {#if propControls.length === 0 && portParams.length === 0 && parameters.length === 0 && outputs.length === 0}
        <div class="empty-state">
          Nothing to show — this node has no parameters or outputs yet
        </div>
      {/if}
      
      {#if node.comment}
        <div class="comment-section">
          <div class="comment">{node.comment}</div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .port-section {
    margin-top: 10px;
  }

  .port-heading {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid #333;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6b6b6b;
    padding: 3px 0;
    margin-bottom: 2px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }

  .port-heading:hover {
    color: #aaa;
  }

  .port-heading .twisty {
    font-size: 8px;
    width: 8px;
  }

  .parameter {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 6px;
    align-items: start;
  }

  /* Deliberately quiet: promotion is occasional, and a button shouting on every
     row would drown the values themselves. */
  .promote {
    margin-top: 7px;
    background: none;
    border: 1px solid #333;
    border-radius: 3px;
    color: #5a5a5a;
    font-size: 8px;
    padding: 0 4px;
    cursor: pointer;
  }

  .promote:hover {
    color: #bbb;
    border-color: #555;
  }

  .promote.on {
    color: #9cdcfe;
    border-color: #2a4a5e;
  }

  .port-heading .tally {
    margin-left: auto;
    letter-spacing: 0;
    color: #555;
  }

  .inspector {
    position: relative;
    width: 100%;
    height: 100%;
    background: rgba(20, 20, 20, 0.95);
    backdrop-filter: blur(10px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .error-badge-container {
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .error-badge {
    padding: 4px 8px;
    background: #ff4444;
    color: white;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
  }
  
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  
  .section {
    margin-bottom: 20px;
  }
  
  .section-header {
    margin-bottom: 8px;
  }
  
  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .content-textarea {
    width: 100%;
    padding: 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 13px;
    font-family: inherit;
    min-height: 60px;
    resize: both;
    overflow: auto;
  }
  
  .content-textarea:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .position-grid,
  .layout-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  
  .position-input-group,
  .layout-input-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .position-label,
  .layout-label {
    font-size: 11px;
    font-weight: 500;
    color: #aaa;
    min-width: 16px;
  }
  
  .position-input,
  .layout-input {
    flex: 1;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    font-family: inherit;
  }
  
  .position-input:focus,
  .layout-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .number-input-with-buttons {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1;
    position: relative;
  }
  
  .number-input-with-buttons .layout-input,
  .number-input-with-buttons .typography-number-input,
  .number-input-with-buttons .appearance-number-input {
    flex: 1;
    margin: 0;
    padding-right: 24px;
  }
  
  .number-input-with-buttons .number-button {
    position: absolute;
    right: 0;
    width: 20px;
    height: 12px;
    padding: 0;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    color: #aaa;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  
  .number-input-with-buttons .number-button.decrement {
    top: 0;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-bottom: none;
  }
  
  .number-input-with-buttons .number-button.increment {
    bottom: 0;
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  
  .number-input-with-buttons .number-button:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
    color: #fff;
  }
  
  .number-input-with-buttons .number-button:active {
    background: rgba(74, 158, 255, 0.2);
    border-color: #4a9eff;
    color: #4a9eff;
  }
  
  .typography-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }
  
  .typography-input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .typography-label {
    font-size: 11px;
    font-weight: 500;
    color: #aaa;
  }
  
  .typography-number-input {
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    font-family: inherit;
    width: 100%;
  }
  
  .typography-number-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .align-buttons {
    display: flex;
    gap: 2px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 2px;
  }
  
  .align-button {
    flex: 1;
    padding: 4px;
    background: transparent;
    border: none;
    border-radius: 2px;
    color: #aaa;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  
  .align-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  
  .align-button.active {
    background: rgba(74, 158, 255, 0.2);
    color: #4a9eff;
  }
  
  .typography-presets {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  
  .preset-button {
    flex: 1;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #aaa;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }
  
  .preset-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.2);
  }
  
  .preset-button.active {
    background: rgba(74, 158, 255, 0.2);
    border-color: #4a9eff;
    color: #4a9eff;
  }
  
  .typography-toggles {
    display: flex;
    gap: 4px;
    margin-top: 8px;
  }
  
  .toggle-button {
    flex: 1;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #aaa;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }
  
  .toggle-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.2);
  }
  
  .toggle-button.active {
    background: rgba(74, 158, 255, 0.2);
    border-color: #4a9eff;
    color: #4a9eff;
  }
  
  .fill-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .color-picker {
    width: 40px;
    height: 32px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    cursor: pointer;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background: none;
    padding: 0;
  }
  
  .color-picker::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  
  .color-picker::-webkit-color-swatch {
    border: none;
    border-radius: 3px;
  }
  
  .color-hex-input {
    flex: 1;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 11px;
    font-family: 'Monaco', 'Menlo', monospace;
    text-transform: uppercase;
  }
  
  .color-hex-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .appearance-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }
  
  .appearance-input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .appearance-label {
    font-size: 11px;
    font-weight: 500;
    color: #aaa;
  }
  
  .appearance-number-input {
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    font-family: inherit;
    width: 100%;
  }
  
  .appearance-number-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .param-input,
  .param-textarea {
    width: 100%;
    padding: 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    font-family: inherit;
  }
  
  .param-input:focus,
  .param-textarea:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .param-textarea {
    min-height: 60px;
    resize: vertical;
  }
  
  .comment-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .comment {
    font-size: 12px;
    color: #888;
    font-style: italic;
    line-height: 1.5;
  }
  
  .empty-state {
    padding: 32px;
    text-align: center;
    color: #666;
    font-size: 14px;
  }
  
  .prop-group {
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .prop-group-row {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  
  .prop-label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    color: #aaa;
    flex-shrink: 0;
    min-width: 80px;
  }
  
  .prop-group-row .prop-label {
    margin-bottom: 0;
  }
  
  .prop-group-row > :global(.vector-input-container) {
    flex: 1;
    min-width: 0;
  }
</style>
