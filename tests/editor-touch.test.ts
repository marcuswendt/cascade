import { describe, expect, it } from 'vitest';
import { bound, FIT, notch, pinch, settle, shareFile, stepOf, stepValue, zoomAt } from '../src/player/editorTouch';

describe('editor on a phone', () => {
  it('pinches around the fingers and keeps the picture covering its box', () => {
    const from = { mid: { x: 100, y: 100 }, distance: 100 };
    const zoomed = pinch(FIT, from, { mid: { x: 100, y: 100 }, distance: 200 });
    expect(zoomed).toEqual({ scale: 2, x: -100, y: -100 });
    expect(pinch(FIT, from, { mid: { x: 100, y: 100 }, distance: 50 }).scale).toBe(1);
    expect(bound({ scale: 2, x: 50, y: -900 }, 400, 400)).toEqual({ scale: 2, x: 0, y: -400 });
    expect(bound({ scale: 1, x: 30, y: 30 }, 400, 400)).toEqual(FIT);
    expect(zoomAt({ x: 200, y: 100 }, 2)).toEqual({ scale: 2, x: -200, y: -100 });
  });

  it('settles the sheet on the nearest snap, or the next one when flicked', () => {
    const snaps = [180, 420, 760];
    expect(settle(310, 0, snaps)).toBe(420);
    expect(settle(250, 0, snaps)).toBe(180);
    expect(settle(250, 1.2, snaps)).toBe(420);
    expect(settle(500, -1.2, snaps)).toBe(420);
    expect(settle(760, 2, snaps)).toBe(760);
  });

  it('steps numbers by the declared step, a nice fraction of the range, or 1', () => {
    expect(stepOf(0.01, 0, 1, false)).toBe(0.01);
    expect(stepOf(undefined, 0.4, 2.5, false)).toBe(0.02);
    expect(stepOf(undefined, undefined, undefined, true)).toBe(1);
    expect(stepValue(0.1, 1, 0.1, 0, 1)).toBe(0.2);
    expect(stepValue(0.95, 1, 0.1, 0, 1)).toBe(1);
    expect(stepValue(-89, -1, 5, -90, 90)).toBe(-90);
    expect(notch(0.55, 0, 1)).toBe(6);
  });

  it('downloads when the browser cannot share files', async () => {
    let saved = 0;
    expect(await shareFile('a.png', new Blob(['x'], { type: 'image/png' }), () => { saved++; })).toBe('downloaded');
    expect(saved).toBe(1);
  });
});
