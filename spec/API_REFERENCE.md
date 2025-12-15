# Cascade API Reference

Quick reference for node development in Cascade.

## Node Basics

### Creating Ports

```typescript
// Input ports - receive data from upstream nodes
const input = node.in<number>('value', 0);           // With default value
const trigger = node.in('trigger', null, { type: 'trigger' }); // Trigger port

// Output ports - send data downstream
const output = node.out<number>('result');
output.setValue(42);

// Trigger output
const tick = node.out('tick', 'trigger');
tick.trigger({ frame: 1 });
```

### Port Properties

```typescript
input.value        // Current value
input.defaultValue // Default value
input.name         // Port name
input.id           // Unique port ID
input.connections  // Connected wires

// Callbacks
input.onChange = (value) => { ... }
trigger.onTrigger = (props) => { ... }
```

## Parameters (Props)

Add UI-controlled parameters to nodes:

```typescript
node.addParm('intensity', {
  value: 1.0,
  params: { min: 0, max: 2, step: 0.1 },
  displayName: 'Intensity',
  onChange: () => node.requestCook()
});

node.addParm('mode', {
  value: 'normal',
  params: {
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' }
    ]
  },
  displayName: 'Blend Mode'
});

node.addParm('color', {
  value: { r: 1, g: 0, b: 0 },
  type: 'color',
  displayName: 'Color'
});

// Access parameter values
const intensity = node.props.intensity.value;
```

### Parameter Options

| Option | Type | Description |
|--------|------|-------------|
| `value` | any | Initial value |
| `params.min` | number | Minimum value (sliders) |
| `params.max` | number | Maximum value (sliders) |
| `params.step` | number | Step increment |
| `params.options` | array | Dropdown options |
| `displayName` | string | UI label |
| `hidden` | () => boolean | Conditional visibility |
| `onChange` | () => void | Value change callback |

## Node Lifecycle

```typescript
// Called when node should recompute
node.requestCook();

// Mark node as needing update
node.markDirty();

// Node state
node.isDirty       // Needs recomputation
node.bypass        // Skip execution
node.error         // Current error (if any)

// Lifecycle hooks
node.onReady = () => { ... }     // Called after setup
node.onDestroy = () => { ... }   // Called before removal
```

## NPM Packages

```typescript
// Load packages dynamically
const three = await node.require('three');
const chroma = await node.require('chroma-js@2.4.2');

// Use immediately
const scene = new three.Scene();
```

## Assets

```typescript
// Load assets
const image = await node.assets.load('./path/to/image.png');
const data = await node.assets.load('./data.json');
```

## Graph Access

```typescript
// Access graph from node
node.graph              // Parent graph
node.graph.nodes        // All nodes
node.graph.connections  // All connections

// Find nodes
node.graph.getNode('nodeId');
node.graph.getElement('elementId');
```

## LensNode (Image Processing)

Extend `LensNode` for image processing nodes:

```typescript
import { LensNode, ImageBuffer } from '@/nodes/lens/LensNode';

class MyFilter extends LensNode {
  protected setup(): void {
    this.in<ImageInput>('image', null);
    this.addParm('amount', { value: 1.0, params: { min: 0, max: 1 } });
    this.out('image');
  }

  protected render(): void {
    const input = this.toImageBuffer(this.inputs[0].value);
    if (!input) return;

    const result = ImageBuffer.rgba(input.width, input.height);

    // Process pixels
    const r = result.r(), g = result.g(), b = result.b(), a = result.a();
    for (let i = 0; i < input.width * input.height; i++) {
      r[i] = input.r()[i] * this.props.amount.value;
      // ...
    }

    this.setOutput(this.outputs[0], result);
  }
}
```

### ImageBuffer API

```typescript
// Create buffers
ImageBuffer.rgba(width, height)    // 4 channels
ImageBuffer.rgb(width, height)     // 3 channels
ImageBuffer.mono(width, height)    // 1 channel

// Channel access
buffer.r(), buffer.g(), buffer.b(), buffer.a()  // Float32Arrays
buffer.channels[0]  // Direct channel access

// Properties
buffer.width, buffer.height, buffer.channelCount

// Operations
buffer.sample(x, y, channel)  // Bilinear sample
buffer.fill(channel, value)   // Fill channel
buffer.toCanvas()             // Convert to HTMLCanvasElement
buffer.toRGBA()               // Convert to 4-channel
```

### Resolution Control (Multi-Input)

```typescript
// In LensNode subclass
const { buffers, width, height } = this.prepareInputs(
  [input1, input2],           // Input values
  'largest',                   // Resolution mode
  'fill',                      // Fit mode
  [512, 512]                   // Custom size (if mode='custom')
);

// Resolution modes: 'input1', 'input2', 'largest', 'smallest', 'custom'
// Fit modes: 'fill', 'fit', 'stretch', 'native'
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Tab | Open node panel |
| Cmd+K | Search packages (in editor) |
| Shift+Enter | Compile code |
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |
| Delete | Delete selected |
| Cmd+A | Select all |

## Data Types & Port Colors

| Color | Type |
|-------|------|
| Gray | Any/unknown |
| Blue | Number |
| Green | String |
| Yellow | Boolean |
| Purple | Object/Array |
| Cyan | Image/Canvas |
| Orange | Trigger |

---

See [CHANGELOG.md](./CHANGELOG.md) for version history.
