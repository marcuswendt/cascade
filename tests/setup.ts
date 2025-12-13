/**
 * Vitest Global Setup
 * Configures mocks and test utilities for all test files
 */

import { vi } from 'vitest';

// Mock localStorage for tests that use stores with persistence
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock.store[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageMock.store[key];
  }),
  clear: vi.fn(() => {
    localStorageMock.store = {};
  }),
  get length() {
    return Object.keys(localStorageMock.store).length;
  },
  key: vi.fn((index: number) => Object.keys(localStorageMock.store)[index] ?? null),
};

// Only stub localStorage if not already available (node environment)
if (typeof globalThis.localStorage === 'undefined') {
  vi.stubGlobal('localStorage', localStorageMock);
}

// Reset localStorage mock between tests
beforeEach(() => {
  localStorageMock.store = {};
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();
});

// Export for tests that need direct access
export { localStorageMock };
