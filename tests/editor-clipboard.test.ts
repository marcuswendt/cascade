// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCascadeClipboard, writeCascadeClipboard } from '@/editor/clipboard';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cascade clipboard', () => {
  it('keeps cut/copy data available when the secure Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });

    // The write reports false, because the *system* clipboard genuinely did not
    // get it — `execCommand` returned false here. The session copy surviving
    // anyway is the point of the test, and the two facts are now separable
    // rather than both hidden behind a void return.
    await expect(writeCascadeClipboard('{"type":"cascade/cut"}')).resolves.toBe(false);
    await expect(readCascadeClipboard()).resolves.toBe('{"type":"cascade/cut"}');
  });

  it('falls back to the session clipboard when browser clipboard access is denied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new DOMException('denied')),
        readText: vi.fn().mockRejectedValue(new DOMException('denied')),
      },
    });

    await writeCascadeClipboard('{"type":"cascade/copy"}');
    expect(await readCascadeClipboard()).toBe('{"type":"cascade/copy"}');
  });
});
