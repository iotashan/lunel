// Security-boundary unit tests for the connection-target / gateway-URL gatekeepers.
// Run with: bun test lib/connectTarget.test.ts
//
// These guard the two security properties of the connect flow:
//  1. The session secret never travels over plaintext to a non-loopback host.
//  2. A direct-mode (secret-bearing) payload is never reinterpreted as a relay
//     code that would carry the secret to the manager's ?code= query.

import { test, expect } from 'bun:test';
import { normalizeGateway, isLocalHostname, parseConnectPayload } from './connectTarget';

const DEF = 'wss://gateway.lunel.dev';

test('normalizeGateway rejects plaintext for a real (non-loopback) host', () => {
  expect(() => normalizeGateway('ws://evil.com', DEF)).toThrow();
  expect(() => normalizeGateway('http://evil.com', DEF)).toThrow();
  expect(() => normalizeGateway('http://gateway.lunel.dev', DEF)).toThrow();
});

test('normalizeGateway rejects hostname-spoofing tricks (no downgrade via parse confusion)', () => {
  const spoofs = [
    'http://evil.com#@localhost',
    'http://evil.com#localhost',
    'http://localhost@evil.com',
    'http://localhost.evil.com',
    'http://127.0.0.1.evil.com',
    'http://[::1]@evil.com',
    'ws://localhost.attacker.test',
  ];
  for (const u of spoofs) {
    expect(() => normalizeGateway(u, DEF), `should reject ${u}`).toThrow();
  }
});

test('normalizeGateway allows genuine loopback as plaintext ws', () => {
  expect(normalizeGateway('ws://localhost:3000', DEF)).toBe('ws://localhost:3000');
  expect(normalizeGateway('http://127.0.0.1:8899', DEF)).toBe('ws://127.0.0.1:8899');
  expect(normalizeGateway('http://localhost', DEF)).toBe('ws://localhost');
});

test('normalizeGateway normalizes secure hosts to wss and trims trailing slash', () => {
  expect(normalizeGateway('https://gateway.lunel.dev', DEF)).toBe('wss://gateway.lunel.dev');
  expect(normalizeGateway('wss://gateway.lunel.dev/', DEF)).toBe('wss://gateway.lunel.dev');
  expect(normalizeGateway('gateway.lunel.dev', DEF)).toBe('wss://gateway.lunel.dev');
});

test('normalizeGateway returns the default for empty input', () => {
  expect(normalizeGateway('', DEF)).toBe(DEF);
  expect(normalizeGateway('   ', DEF)).toBe(DEF);
});

test('isLocalHostname only matches genuine loopback', () => {
  for (const h of ['localhost', '127.0.0.1', '::1', '[::1]', 'LOCALHOST']) expect(isLocalHostname(h)).toBe(true);
  for (const h of ['localhost.evil.com', '127.0.0.1.evil.com', 'evil.com', '10.0.0.1', 'notlocalhost']) expect(isLocalHostname(h)).toBe(false);
});

test('parseConnectPayload: a secret never leaks into a relay code', () => {
  const secret = 'SUPERSECRET_DO_NOT_LEAK_123';

  // Valid direct payload -> stays direct.
  const valid = parseConnectPayload(JSON.stringify({ v: 1, mode: 'direct', fqdn: 'h.ts.net', port: 49298, secret }));
  expect(valid.kind).toBe('direct');

  // Malformed direct (missing port) -> must NOT become a relay code carrying the secret.
  const malformed = parseConnectPayload(JSON.stringify({ mode: 'direct', secret }));
  expect(malformed.kind === 'relay' ? malformed.code : '').not.toContain(secret);

  // Any object merely containing a `secret` is treated as direct-shaped -> never a secret-bearing relay code.
  const secretOnly = parseConnectPayload(JSON.stringify({ secret }));
  expect(secretOnly.kind === 'relay' ? secretOnly.code : '').not.toContain(secret);
});

test('parseConnectPayload: relay short codes and URL/query forms still parse', () => {
  expect(parseConnectPayload('abc123')).toEqual({ kind: 'relay', code: 'abc123' });
  expect(parseConnectPayload('lunel://connect?code=XYZ')).toEqual({ kind: 'relay', code: 'XYZ' });
});
