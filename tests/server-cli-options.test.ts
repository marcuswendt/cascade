import { describe, expect, it } from 'vitest';
import { parseStudioArgs } from '../server/src/cliCommands.js';

describe('Studio CLI options', () => {
  it('parses explicit bind, port, trusted host, and browser options', () => {
    expect(parseStudioArgs(['.', '--host', 'KURO', '--port=3131', '--no-open'])).toEqual({
      positional: ['.'],
      noOpen: true,
      host: 'KURO',
      port: 3131,
      trustedHosts: ['KURO'],
    });
    expect(parseStudioArgs(['.', '--host', '100.64.0.10', '--trusted-host', 'kuro'])).toMatchObject({
      host: '100.64.0.10', trustedHosts: ['kuro'],
    });
  });

  it('rejects unknown, missing, and invalid options instead of silently ignoring them', () => {
    expect(() => parseStudioArgs(['.', '--porrt', '3131'])).toThrow('unknown option: --porrt');
    expect(() => parseStudioArgs(['.', '--host'])).toThrow('--host requires a value');
    expect(() => parseStudioArgs(['.', '--port', 'not-a-port'])).toThrow('--port must be an integer between 1 and 65535');
    expect(() => parseStudioArgs(['.', '--host', '0.0.0.0', '--trusted-host', 'kuro'])).toThrow('not a wildcard address');
    expect(() => parseStudioArgs(['.', '--trusted-host', 'kuro'])).toThrow('requires an explicit non-loopback --host');
    expect(() => parseStudioArgs(['.', '--host', 'KURO', '--trusted-host', 'kuro:3030'])).toThrow('Invalid trusted host');
  });
});
