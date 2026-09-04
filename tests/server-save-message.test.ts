import { describe, expect, it } from 'vitest';
import { saveCommitMessage } from '../server/src/routes/graph.js';

describe('saveCommitMessage', () => {
  it('names the file and the time, so two saves are told apart in the version list', () => {
    const at = new Date('2026-09-04T15:33:07Z');
    const message = saveCommitMessage('cloud-plots.cascade', at);
    expect(message).toMatch(/^Saved cloud-plots\.cascade \d{2}:\d{2}$/);
  });

  it('uses a 24-hour clock rather than am/pm', () => {
    const message = saveCommitMessage('index.cascade', new Date('2026-09-04T18:05:00Z'));
    expect(message).not.toMatch(/am|pm/i);
  });

  it('differs between two saves a minute apart', () => {
    const first = saveCommitMessage('index.cascade', new Date('2026-09-04T15:33:00Z'));
    const second = saveCommitMessage('index.cascade', new Date('2026-09-04T15:34:00Z'));
    expect(first).not.toBe(second);
  });
});
