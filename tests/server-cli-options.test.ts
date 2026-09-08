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

  it('accepts a loopback bind with a trusted host, which is the reverse-proxy case', () => {
    /**
     * This was refused, and the refusal made HTTPS unreachable: `tailscale
     * serve` terminates TLS and proxies to loopback, so the browser never
     * reaches the bind address and no configuration could satisfy the old
     * requirement. Three constraints excluded each other.
     *
     * Safe for the reason the refusal was protecting — a loopback bind means
     * the only possible peer is a local process, measured as
     * `remoteAddress: 127.0.0.1` through the proxy on 2026-09-08.
     */
    const parsed = parseStudioArgs([
      '.', '--host', '127.0.0.1', '--port', '3030',
      '--trusted-host', 'kuro.hydra-diatonic.ts.net:8444',
    ]);
    expect(parsed).toMatchObject({
      host: '127.0.0.1',
      port: 3030,
      trustedHosts: ['kuro.hydra-diatonic.ts.net:8444'],
    });
  });

  it('rejects unknown, missing, and invalid options instead of silently ignoring them', () => {
    expect(() => parseStudioArgs(['.', '--porrt', '3131'])).toThrow('unknown option: --porrt');
    expect(() => parseStudioArgs(['.', '--host'])).toThrow('--host requires a value');
    expect(() => parseStudioArgs(['.', '--port', 'not-a-port'])).toThrow('--port must be an integer between 1 and 65535');
    expect(() => parseStudioArgs(['.', '--host', '0.0.0.0', '--trusted-host', 'kuro'])).toThrow('not a wildcard address');

    expect(() => parseStudioArgs(['.', '--trusted-host', 'kuro'])).toThrow('requires an explicit --host bind address');
    // A port in a trusted host is now the proxy case rather than an error —
    // see below. A malformed one is still refused.
    expect(() => parseStudioArgs(['.', '--host', 'KURO', '--trusted-host', 'kuro:0'])).toThrow('Invalid trusted host port');
    expect(() => parseStudioArgs(['.', '--host', 'KURO', '--trusted-host', 'kuro:notaport'])).toThrow('Invalid trusted host');
  });
});
