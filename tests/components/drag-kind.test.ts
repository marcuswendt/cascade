import { describe, expect, it } from 'vitest';
import { isFileDrag } from '@/editor/dragKind';

const drag = (types: string[]) => ({ dataTransfer: { types } as unknown as DataTransfer });

describe('isFileDrag', () => {
  it('claims a file drag, which is the one the canvas can use', () => {
    expect(isFileDrag(drag(['Files']))).toBe(true);
  });

  it('leaves a dockview panel drag alone, so the panel can dock over the graph', () => {
    // Dockview advertises its own mime type and no Files entry. Claiming this
    // is what left the drop indicator stuck over the network view.
    expect(isFileDrag(drag(['application/vnd.dockview.panel']))).toBe(false);
  });

  it('leaves a plain text drag alone', () => {
    expect(isFileDrag(drag(['text/plain']))).toBe(false);
  });

  it('claims a mixed drag that includes files', () => {
    expect(isFileDrag(drag(['text/uri-list', 'Files']))).toBe(true);
  });

  it('treats an absent dataTransfer as not a file drag rather than throwing', () => {
    expect(isFileDrag({ dataTransfer: null })).toBe(false);
    expect(isFileDrag({} as DragEvent)).toBe(false);
  });
});
