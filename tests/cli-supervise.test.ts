import { describe, expect, it, vi } from 'vitest';
import { superviseProcess } from '../src/cli/supervise';

describe('bounded render process', () => {
  it('preserves successful and failed exit codes', async () => {
    expect(await superviseProcess(process.execPath, ['-e', 'process.exitCode=0'], 5000)).toBe(0);
    expect(await superviseProcess(process.execPath, ['-e', 'process.exitCode=7'], 5000)).toBe(7);
  });
  it('terminates even synchronously blocked code and removes signal handlers', async () => {
    const before = process.listenerCount('SIGTERM');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await superviseProcess(process.execPath, ['-e', 'while(true){}'], 100)).toBe(124);
      expect(process.listenerCount('SIGTERM')).toBe(before);
      expect(log).toHaveBeenCalledWith('Render timed out after 100 ms');
    } finally { log.mockRestore(); }
  });
});
