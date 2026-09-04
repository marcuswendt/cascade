import { describe, expect, it } from 'vitest';
import { clampToViewport } from '@/editor/menuPlacement';

const viewport = { width: 1280, height: 900 };
const menu = { width: 160, height: 240 };

describe('clampToViewport', () => {
  it('leaves a menu with room where its button put it', () => {
    expect(clampToViewport({ x: 400, y: 120 }, menu, viewport)).toEqual({ x: 400, y: 120 });
  });

  it('slides a menu back in when its button is at the right edge', () => {
    // The panel group's add button sits at the right edge, which is the case
    // that sent the menu off-screen.
    expect(clampToViewport({ x: 1265, y: 120 }, menu, viewport).x).toBe(1112);
  });

  it('slides a menu up when its button is near the bottom', () => {
    expect(clampToViewport({ x: 400, y: 880 }, menu, viewport).y).toBe(652);
  });

  it('keeps the margin on both axes at once', () => {
    expect(clampToViewport({ x: 1279, y: 899 }, menu, viewport)).toEqual({ x: 1112, y: 652 });
  });

  it('pins a menu taller than the window to the top margin rather than pushing its first entries off', () => {
    expect(clampToViewport({ x: 400, y: 100 }, { width: 160, height: 2000 }, viewport).y).toBe(8);
  });

  it('honours a caller-supplied margin', () => {
    expect(clampToViewport({ x: 1265, y: 120 }, menu, viewport, 24).x).toBe(1096);
  });
});
