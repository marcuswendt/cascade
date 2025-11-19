<script lang="ts">
  import type { Prop } from '@/types/node.types';
  import { onMount } from 'svelte';
  import { openColorPickerId } from '../stores/colorPickerStore';
  import { normalizeColor, colorToHex, colorToCss, type ColorObject } from '@/utils/colorUtils';
  
  export let prop: Prop;
  export let id: string;
  export let onValueChange: (value: ColorObject) => void;
  
  let showPicker = false;
  
  // Subscribe to store to close this picker if another opens
  let unsubscribe: (() => void) | null = null;
  let pickerElement: HTMLDivElement;
  let wheelCanvas: HTMLCanvasElement;
  let wheelCtx: CanvasRenderingContext2D | null = null;
  
  // Color state
  let hue = 210;
  let saturation = 1;
  let brightness = 0.5;
  let red = 0;
  let green = 0.25;
  let blue = 0.5;
  let hex = '#003F7F';
  
  // Previous color
  let previousColor = '#000000';
  
  // Color mode: 'hsv' or 'rgb'
  let colorMode: 'hsv' | 'rgb' = 'hsv';
  
  // Palette swatches - 16 columns, 4 rows (64 colors with smooth transitions)
  const palette = [
    // Row 1: Full spectrum red to cyan with many intermediate steps
    ['#FF0000', '#FF2000', '#FF4000', '#FF6000', '#FF8000', '#FFA000', '#FFC000', '#FFE000', '#FFFF00', '#E0FF00', '#C0FF00', '#A0FF00', '#80FF00', '#60FF00', '#40FF00', '#20FF00'],
    // Row 2: Green to magenta spectrum
    ['#00FF00', '#00FF20', '#00FF40', '#00FF60', '#00FF80', '#00FFA0', '#00FFC0', '#00FFE0', '#00FFFF', '#00E0FF', '#00C0FF', '#00A0FF', '#0080FF', '#0060FF', '#0040FF', '#0020FF'],
    // Row 3: Blue to red spectrum
    ['#0000FF', '#2000FF', '#4000FF', '#6000FF', '#8000FF', '#A000FF', '#C000FF', '#E000FF', '#FF00FF', '#FF00E0', '#FF00C0', '#FF00A0', '#FF0080', '#FF0060', '#FF0040', '#FF0020'],
    // Row 4: Grayscale ramp (dark to light)
    ['#000000', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999', '#AAAAAA', '#BBBBBB', '#CCCCCC', '#DDDDDD', '#EEEEEE', '#FFFFFF']
  ];
  
  // Convert hex to RGB
  function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    } : { r: 0, g: 0, b: 0 };
  }
  
  // Convert RGB to HSV
  function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    
    let h = 0;
    if (delta !== 0) {
      if (max === r) {
        h = ((g - b) / delta) % 6;
      } else if (max === g) {
        h = (b - r) / delta + 2;
      } else {
        h = (r - g) / delta + 4;
      }
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;
    
    const s = max === 0 ? 0 : delta / max;
    const v = max;
    
    return { h, s, v };
  }
  
  // Convert HSV to RGB
  function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    
    let r = 0, g = 0, b = 0;
    
    if (h < 60) {
      r = c; g = x; b = 0;
    } else if (h < 120) {
      r = x; g = c; b = 0;
    } else if (h < 180) {
      r = 0; g = c; b = x;
    } else if (h < 240) {
      r = 0; g = x; b = c;
    } else if (h < 300) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }
    
    return {
      r: r + m,
      g: g + m,
      b: b + m
    };
  }
  
  // Convert RGB to hex
  function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (n: number) => {
      const hex = Math.round(n * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  }
  
  // Update color from color object or string (for backward compatibility)
  function updateFromColor(colorValue: ColorObject | string) {
    // Normalize to color object
    const colorObj = normalizeColor(colorValue as any);
    
    // Update internal hex for display
    hex = colorToHex(colorObj).toUpperCase();
    
    // Update RGB values (0-1 range)
    red = colorObj.r;
    green = colorObj.g;
    blue = colorObj.b;
    
    const hsv = rgbToHsv(red, green, blue);
    hue = hsv.h;
    saturation = hsv.s;
    brightness = hsv.v;
    
    // Only redraw wheel if context is ready
    if (wheelCtx && wheelCanvas) {
      drawWheel();
    }
  }
  
  // Update color from hex value (kept for backward compatibility)
  function updateFromHex(hexValue: string) {
    updateFromColor(hexValue);
  }
  
  // Update color from HSV
  function updateFromHsv() {
    const rgb = hsvToRgb(hue, saturation, brightness);
    red = rgb.r;
    green = rgb.g;
    blue = rgb.b;
    hex = rgbToHex(red, green, blue);
    // Convert to color object for storage
    const colorObj: ColorObject = { r: red, g: green, b: blue, a: 1.0 };
    onValueChange(colorObj);
    // Only redraw wheel if context is ready
    if (wheelCtx && wheelCanvas) {
      drawWheel();
    }
  }
  
  // Update color from RGB
  function updateFromRgb() {
    hex = rgbToHex(red, green, blue);
    const hsv = rgbToHsv(red, green, blue);
    hue = hsv.h;
    saturation = hsv.s;
    brightness = hsv.v;
    // Convert to color object for storage
    const colorObj: ColorObject = { r: red, g: green, b: blue, a: 1.0 };
    onValueChange(colorObj);
    // Only redraw wheel if context is ready
    if (wheelCtx && wheelCanvas) {
      drawWheel();
    }
  }
  
  // Draw color wheel
  function drawWheel() {
    if (!wheelCtx || !wheelCanvas) {
      console.warn('ColorPicker: Cannot draw wheel - context or canvas missing');
      return;
    }
    
    const size = wheelCanvas.width;
    const center = size / 2;
    const outerRadius = center - 2;
    const innerRadius = outerRadius - 9; // Inner circle radius (outer ring is 9px thick, 2x thinner)
    
    wheelCtx.clearRect(0, 0, size, size);
    
    // Draw color wheel using image data for better performance
    const imageData = wheelCtx.createImageData(size, size);
    const data = imageData.data;
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center;
        const dy = y - center;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
        
        if (distance <= outerRadius && distance > innerRadius) {
          // Outer ring: pure hues (s = 1, v = 1)
          const rgb = hsvToRgb(angle, 1, 1);
          const index = (y * size + x) * 4;
          data[index] = Math.round(rgb.r * 255);
          data[index + 1] = Math.round(rgb.g * 255);
          data[index + 2] = Math.round(rgb.b * 255);
          data[index + 3] = 255;
        } else if (distance <= innerRadius) {
          if (colorMode === 'rgb') {
            // RGB mode: Use angle for Red-Green blend, distance for Blue
            // Angle: 0° = red, 120° = green, 240° = blue
            // Normalize angle to 0-1 range
            const normalizedAngle = angle / 360;
            
            // Map angle to Red-Green gradient
            // 0-120°: Red to Green (R decreases, G increases)
            // 120-240°: Green to Blue (G decreases, B increases)  
            // 240-360°: Blue to Red (B decreases, R increases)
            let r = 0, g = 0, b = 0;
            
            if (normalizedAngle < 1/3) {
              // Red to Green
              const t = normalizedAngle * 3;
              r = 1 - t;
              g = t;
              b = 0;
            } else if (normalizedAngle < 2/3) {
              // Green to Blue
              const t = (normalizedAngle - 1/3) * 3;
              r = 0;
              g = 1 - t;
              b = t;
            } else {
              // Blue to Red
              const t = (normalizedAngle - 2/3) * 3;
              r = t;
              g = 0;
              b = 1 - t;
            }
            
            // Use distance for Blue component blending
            // Center has no blue (0), edge has full blue (1)
            // Blend the RGB gradient with blue based on distance
            const blueFactor = distance / innerRadius;
            const invBlueFactor = 1 - blueFactor;
            
            // Mix: (1 - blueFactor) * RGB_gradient + blueFactor * blue
            r = r * invBlueFactor + 0 * blueFactor;
            g = g * invBlueFactor + 0 * blueFactor;
            b = b * invBlueFactor + 1 * blueFactor;
            
            // Also blend towards white at center (decrease saturation)
            const saturationFactor = distance / innerRadius;
            r = r * saturationFactor + (1 - saturationFactor);
            g = g * saturationFactor + (1 - saturationFactor);
            b = b * saturationFactor + (1 - saturationFactor);
            
            const index = (y * size + x) * 4;
            data[index] = Math.round(r * 255);
            data[index + 1] = Math.round(g * 255);
            data[index + 2] = Math.round(b * 255);
            data[index + 3] = 255;
          } else {
            // HSV mode: inner circle shows all hues with saturation decreasing towards center
            // Center is white (s=0), edge is fully saturated (s=1)
            // Use angle for hue, distance for saturation, current brightness value
            const s = distance / innerRadius;
            const v = brightness;
            const rgb = hsvToRgb(angle, s, v);
            const index = (y * size + x) * 4;
            data[index] = Math.round(rgb.r * 255);
            data[index + 1] = Math.round(rgb.g * 255);
            data[index + 2] = Math.round(rgb.b * 255);
            data[index + 3] = 255;
          }
        } else {
          // Set transparent for pixels outside the wheel
          const index = (y * size + x) * 4;
          data[index] = 0;
          data[index + 1] = 0;
          data[index + 2] = 0;
          data[index + 3] = 0;
        }
      }
    }
    
    wheelCtx.putImageData(imageData, 0, 0);
    
    // Draw indicators based on color mode
    if (colorMode === 'rgb') {
      // RGB mode: Calculate angle from current RGB values
      // Find the angle that best represents the current color
      const currentAngle = Math.atan2(green - red, red - blue) * 180 / Math.PI + 90;
      const normalizedAngle = (currentAngle + 360) % 360;
      
      // Draw indicator on outer ring
      const outerIndicatorX = center + Math.cos((normalizedAngle - 90) * Math.PI / 180) * (outerRadius - 2);
      const outerIndicatorY = center + Math.sin((normalizedAngle - 90) * Math.PI / 180) * (outerRadius - 2);
      
      wheelCtx.strokeStyle = '#fff';
      wheelCtx.lineWidth = 2;
      wheelCtx.beginPath();
      wheelCtx.arc(outerIndicatorX, outerIndicatorY, 4, 0, Math.PI * 2);
      wheelCtx.stroke();
      
      wheelCtx.strokeStyle = '#000';
      wheelCtx.lineWidth = 1;
      wheelCtx.beginPath();
      wheelCtx.arc(outerIndicatorX, outerIndicatorY, 5, 0, Math.PI * 2);
      wheelCtx.stroke();
      
      // Draw indicator on inner circle based on RGB position
      // Use normalized position from RGB values
      const rgbDistance = Math.sqrt(red * red + green * green + blue * blue) / Math.sqrt(3);
      const indicatorX = center + Math.cos((normalizedAngle - 90) * Math.PI / 180) * (rgbDistance * innerRadius);
      const indicatorY = center + Math.sin((normalizedAngle - 90) * Math.PI / 180) * (rgbDistance * innerRadius);
      
      wheelCtx.strokeStyle = '#fff';
      wheelCtx.lineWidth = 2;
      wheelCtx.beginPath();
      wheelCtx.arc(indicatorX, indicatorY, 6, 0, Math.PI * 2);
      wheelCtx.stroke();
      
      wheelCtx.strokeStyle = '#000';
      wheelCtx.lineWidth = 1;
      wheelCtx.beginPath();
      wheelCtx.arc(indicatorX, indicatorY, 7, 0, Math.PI * 2);
      wheelCtx.stroke();
    } else {
      // HSV mode: Draw hue indicator on outer ring
      const outerIndicatorX = center + Math.cos((hue - 90) * Math.PI / 180) * (outerRadius - 2);
      const outerIndicatorY = center + Math.sin((hue - 90) * Math.PI / 180) * (outerRadius - 2);
      
      wheelCtx.strokeStyle = '#fff';
      wheelCtx.lineWidth = 2;
      wheelCtx.beginPath();
      wheelCtx.arc(outerIndicatorX, outerIndicatorY, 4, 0, Math.PI * 2);
      wheelCtx.stroke();
      
      wheelCtx.strokeStyle = '#000';
      wheelCtx.lineWidth = 1;
      wheelCtx.beginPath();
      wheelCtx.arc(outerIndicatorX, outerIndicatorY, 5, 0, Math.PI * 2);
      wheelCtx.stroke();
      
      // Draw current color indicator on inner circle
      const indicatorX = center + Math.cos((hue - 90) * Math.PI / 180) * (saturation * innerRadius);
      const indicatorY = center + Math.sin((hue - 90) * Math.PI / 180) * (saturation * innerRadius);
      
      wheelCtx.strokeStyle = '#fff';
      wheelCtx.lineWidth = 2;
      wheelCtx.beginPath();
      wheelCtx.arc(indicatorX, indicatorY, 6, 0, Math.PI * 2);
      wheelCtx.stroke();
      
      wheelCtx.strokeStyle = '#000';
      wheelCtx.lineWidth = 1;
      wheelCtx.beginPath();
      wheelCtx.arc(indicatorX, indicatorY, 7, 0, Math.PI * 2);
      wheelCtx.stroke();
    }
  }
  
  // Handle wheel click
  function handleWheelClick(e: MouseEvent) {
    e.stopPropagation();
    if (!wheelCanvas) return;
    const rect = wheelCanvas.getBoundingClientRect();
    const scaleX = wheelCanvas.width / rect.width;
    const scaleY = wheelCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const center = wheelCanvas.width / 2;
    const dx = x - center;
    const dy = y - center;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const outerRadius = center - 2;
    const innerRadius = outerRadius - 9;
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    
    if (colorMode === 'rgb') {
      if (distance <= outerRadius && distance > innerRadius) {
        // Clicked on outer ring - set RGB based on angle
        const normalizedAngle = angle / 360;
        let r = 0, g = 0, b = 0;
        
        if (normalizedAngle < 1/3) {
          const t = normalizedAngle * 3;
          r = 1 - t;
          g = t;
          b = 0;
        } else if (normalizedAngle < 2/3) {
          const t = (normalizedAngle - 1/3) * 3;
          r = 0;
          g = 1 - t;
          b = t;
        } else {
          const t = (normalizedAngle - 2/3) * 3;
          r = t;
          g = 0;
          b = 1 - t;
        }
        
        red = r;
        green = g;
        blue = b;
        updateFromRgb();
      } else if (distance <= innerRadius) {
        // Clicked on inner circle - set RGB based on angle and distance
        const normalizedAngle = angle / 360;
        let r = 0, g = 0, b = 0;
        
        if (normalizedAngle < 1/3) {
          const t = normalizedAngle * 3;
          r = 1 - t;
          g = t;
          b = 0;
        } else if (normalizedAngle < 2/3) {
          const t = (normalizedAngle - 1/3) * 3;
          r = 0;
          g = 1 - t;
          b = t;
        } else {
          const t = (normalizedAngle - 2/3) * 3;
          r = t;
          g = 0;
          b = 1 - t;
        }
        
        // Blend with blue based on distance
        const blueFactor = distance / innerRadius;
        const invBlueFactor = 1 - blueFactor;
        r = r * invBlueFactor;
        g = g * invBlueFactor;
        b = b * invBlueFactor + blueFactor;
        
        // Blend towards white at center
        const saturationFactor = distance / innerRadius;
        r = r * saturationFactor + (1 - saturationFactor);
        g = g * saturationFactor + (1 - saturationFactor);
        b = b * saturationFactor + (1 - saturationFactor);
        
        red = Math.max(0, Math.min(1, r));
        green = Math.max(0, Math.min(1, g));
        blue = Math.max(0, Math.min(1, b));
        updateFromRgb();
      }
    } else {
      // HSV mode
      if (distance <= outerRadius && distance > innerRadius) {
        // Clicked on outer ring - set hue only
        hue = angle;
        updateFromHsv();
      } else if (distance <= innerRadius) {
        // Clicked on inner circle - set both hue and saturation (keep current brightness)
        hue = angle;
        saturation = Math.min(1, distance / innerRadius);
        updateFromHsv();
      }
    }
  }
  
  // Handle RGB input
  function handleRgbInput(component: 'r' | 'g' | 'b', e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value) / 255;
    if (component === 'r') red = Math.max(0, Math.min(1, value));
    if (component === 'g') green = Math.max(0, Math.min(1, value));
    if (component === 'b') blue = Math.max(0, Math.min(1, value));
    updateFromRgb();
  }
  
  // Handle HSV input
  function handleHsvInput(component: 'h' | 's' | 'v', e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (component === 'h') hue = Math.max(0, Math.min(360, value));
    if (component === 's') saturation = Math.max(0, Math.min(1, value / 100));
    if (component === 'v') brightness = Math.max(0, Math.min(1, value / 100));
    updateFromHsv();
  }
  
  // Handle hex input
  function handleHexInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    if (/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(value)) {
      const colorObj = normalizeColor(value);
      updateFromColor(colorObj);
      onValueChange(colorObj);
    }
  }
  
  // Select color from palette
  function selectPaletteColor(color: string) {
    previousColor = hex;
    const colorObj = normalizeColor(color);
    updateFromColor(colorObj);
    onValueChange(colorObj);
  }
  
  // Swap previous/current
  function swapColors() {
    const temp = previousColor;
    previousColor = hex;
    const colorObj = normalizeColor(temp);
    updateFromColor(colorObj);
    onValueChange(colorObj);
  }
  
  // Close picker when clicking outside
  function handleClickOutside(e: MouseEvent) {
    if (pickerElement && !pickerElement.contains(e.target as Node)) {
      showPicker = false;
      openColorPickerId.set(null);
    }
  }
  
  onMount(() => {
    // Initialize from prop value (supports color object, hex, or rgb string)
    if (prop.value) {
      updateFromColor(prop.value as any);
    }
    
    // Subscribe to color picker store
    unsubscribe = openColorPickerId.subscribe((openId) => {
      if (openId !== id && showPicker) {
        showPicker = false;
      }
    });
    
    // Draw wheel - use setTimeout to ensure canvas is ready
    setTimeout(() => {
      if (wheelCanvas) {
        wheelCtx = wheelCanvas.getContext('2d');
        if (wheelCtx) {
          drawWheel();
        }
      }
    }, 0);
    
    // Handle clicks outside
    document.addEventListener('click', handleClickOutside);
    
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
      document.removeEventListener('click', handleClickOutside);
    };
  });
  
  // Redraw wheel when picker opens or canvas is bound
  let wheelDrawTimeout: ReturnType<typeof setTimeout> | null = null;
  
  $: if (showPicker && wheelCanvas) {
    if (wheelDrawTimeout) {
      clearTimeout(wheelDrawTimeout);
    }
    if (!wheelCtx) {
      wheelCtx = wheelCanvas.getContext('2d');
    }
    if (wheelCtx) {
      // Use a small delay to ensure DOM is fully ready
      wheelDrawTimeout = setTimeout(() => {
        if (wheelCanvas && wheelCtx) {
          drawWheel();
        }
      }, 50);
    }
  }
  
  // Watch for prop value changes (supports color object, hex, or rgb string)
  $: if (prop.value) {
    // Only update if the value is different from what we'd output
    const colorObj = normalizeColor(prop.value as any);
    const currentHex = colorToHex(colorObj);
    if (currentHex !== hex) {
      updateFromColor(colorObj);
    }
  }
  
  // Redraw wheel when color mode changes
  $: if (colorMode && wheelCtx && wheelCanvas) {
    drawWheel();
  }
</script>

<div class="color-picker-container">
  <button
    class="color-swatch"
    style="background-color: {colorToCss({ r: red, g: green, b: blue, a: 1.0 })};"
    on:click|stopPropagation={() => {
      if (showPicker) {
        showPicker = false;
        openColorPickerId.set(null);
      } else {
        // Close any other open picker first
        openColorPickerId.set(id);
        showPicker = true;
        if (wheelCanvas && !wheelCtx) {
          wheelCtx = wheelCanvas.getContext('2d');
        }
      }
    }}
    disabled={typeof prop.disabled === 'function' ? prop.disabled() : prop.disabled}
  >
  </button>
  
  {#if showPicker}
    <div class="picker-popover" bind:this={pickerElement} on:click|stopPropagation>
      <div class="picker-header">
        <button class="mode-button" class:active={colorMode === 'hsv'} on:click={() => {
          colorMode = 'hsv';
          if (wheelCtx && wheelCanvas) {
            drawWheel();
          }
        }}>HSV</button>
        <button class="mode-button" class:active={colorMode === 'rgb'} on:click={() => {
          colorMode = 'rgb';
          if (wheelCtx && wheelCanvas) {
            drawWheel();
          }
        }}>RGB</button>
      </div>
      
      <div class="picker-content">
        <div class="wheel-section">
          <canvas
            bind:this={wheelCanvas}
            width={180}
            height={180}
            class="color-wheel"
            on:click|stopPropagation={handleWheelClick}
            on:mousedown|stopPropagation={(e) => {
              handleWheelClick(e);
            }}
            on:mousemove|stopPropagation={(e) => {
              if (e.buttons === 1) {
                handleWheelClick(e);
              }
            }}
          ></canvas>
        </div>
        
        <div class="inputs-section">
          {#if colorMode === 'hsv'}
            <div class="input-row">
              <label>H</label>
              <input type="number" min="0" max="360" value={Math.round(hue)} on:input={(e) => handleHsvInput('h', e)} class="number-input-small" />
              <input type="range" min="0" max="360" step="1" value={Math.round(hue)} on:input={(e) => handleHsvInput('h', e)} class="slider-input" />
            </div>
            <div class="input-row">
              <label>S</label>
              <input type="number" min="0" max="100" value={Math.round(saturation * 100)} on:input={(e) => handleHsvInput('s', e)} class="number-input-small" />
              <input type="range" min="0" max="100" step="1" value={Math.round(saturation * 100)} on:input={(e) => handleHsvInput('s', e)} class="slider-input" />
            </div>
            <div class="input-row">
              <label>V</label>
              <input type="number" min="0" max="100" value={Math.round(brightness * 100)} on:input={(e) => handleHsvInput('v', e)} class="number-input-small" />
              <input type="range" min="0" max="100" step="1" value={Math.round(brightness * 100)} on:input={(e) => handleHsvInput('v', e)} class="slider-input" />
            </div>
          {:else}
            <div class="input-row">
              <label>R</label>
              <input type="number" min="0" max="255" value={Math.round(red * 255)} on:input={(e) => handleRgbInput('r', e)} class="number-input-small" />
              <input type="range" min="0" max="255" step="1" value={Math.round(red * 255)} on:input={(e) => handleRgbInput('r', e)} class="slider-input" />
            </div>
            <div class="input-row">
              <label>G</label>
              <input type="number" min="0" max="255" value={Math.round(green * 255)} on:input={(e) => handleRgbInput('g', e)} class="number-input-small" />
              <input type="range" min="0" max="255" step="1" value={Math.round(green * 255)} on:input={(e) => handleRgbInput('g', e)} class="slider-input" />
            </div>
            <div class="input-row">
              <label>B</label>
              <input type="number" min="0" max="255" value={Math.round(blue * 255)} on:input={(e) => handleRgbInput('b', e)} class="number-input-small" />
              <input type="range" min="0" max="255" step="1" value={Math.round(blue * 255)} on:input={(e) => handleRgbInput('b', e)} class="slider-input" />
            </div>
          {/if}
          
          <div class="input-row">
            <label>Hex</label>
            <input type="text" value={hex} on:input={handleHexInput} class="hex-input" />
          </div>
        </div>
        
        <div class="palette-section">
          <div class="color-history">
            <button class="history-swatch" style="background-color: {previousColor};" on:click={swapColors} title="Swap with previous"></button>
            <button class="history-swatch" style="background-color: {hex};"></button>
          </div>
          <div class="palette-grid">
            {#each palette as row}
              {#each row as color}
                <button
                  class="palette-swatch"
                  style="background-color: {color};"
                  on:click={() => selectPaletteColor(color)}
                ></button>
              {/each}
            {/each}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .color-picker-container {
    position: relative;
    width: 100%;
  }
  
  .color-swatch {
    width: 100%;
    height: 32px;
    background: #000;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    transition: border-color 0.15s ease;
  }
  
  .color-swatch:hover:not(:disabled) {
    border-color: #4a9eff;
  }
  
  .color-swatch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .swatch-label {
    font-size: 11px;
    font-family: 'Monaco', 'Menlo', monospace;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    pointer-events: none;
  }
  
  .picker-popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 1000;
    background: rgba(20, 20, 20, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    min-width: 280px;
  }
  
  .picker-header {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  
  .mode-button {
    flex: 1;
    padding: 4px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #aaa;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .mode-button:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  
  .mode-button.active {
    background: rgba(74, 158, 255, 0.2);
    border-color: #4a9eff;
    color: #4a9eff;
  }
  
  .picker-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .wheel-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  
  .color-wheel {
    border-radius: 50%;
    cursor: crosshair;
    display: block;
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
  }
  
  .brightness-control {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }
  
  .brightness-control label {
    font-size: 11px;
    color: #aaa;
    min-width: 20px;
  }
  
  .inputs-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .input-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .input-row label {
    font-size: 11px;
    color: #aaa;
    min-width: 20px;
  }
  
  .slider-input {
    flex: 1;
    min-width: 0;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
  }
  
  .slider-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    background: #4a9eff;
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  
  .slider-input:hover::-webkit-slider-thumb {
    background: #6bb6ff;
  }
  
  .slider-input::-moz-range-thumb {
    width: 12px;
    height: 12px;
    background: #4a9eff;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    transition: background 0.15s ease;
  }
  
  .slider-input:hover::-moz-range-thumb {
    background: #6bb6ff;
  }
  
  .number-input-small {
    width: 50px;
    flex-shrink: 0;
    padding: 3px 4px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #fff;
    font-size: 11px;
    font-family: 'Monaco', 'Menlo', monospace;
    text-align: right;
  }
  
  .number-input-small:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .hex-input {
    flex: 1;
    padding: 4px 6px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #fff;
    font-size: 11px;
    font-family: 'Monaco', 'Menlo', monospace;
    text-transform: uppercase;
  }
  
  .hex-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .palette-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .color-history {
    display: flex;
    gap: 2px;
  }
  
  .history-swatch {
    width: 12px;
    height: 12px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    cursor: pointer;
    padding: 0;
  }
  
  .history-swatch:hover {
    border-color: #4a9eff;
    transform: scale(1.1);
  }
  
  .palette-grid {
    display: grid;
    grid-template-columns: repeat(16, 1fr);
    gap: 0;
    width: 100%;
  }
  
  .palette-swatch {
    width: 100%;
    height: 16px;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: all 0.1s ease;
    box-sizing: border-box;
  }
  
  .palette-swatch:hover {
    transform: scale(1.1);
    outline: 2px solid #4a9eff;
    outline-offset: -2px;
    z-index: 1;
    position: relative;
  }
</style>

