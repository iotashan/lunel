// Unit tests for the V2 session-URL builder (pure). Run: bun test lib/transport/protocol.test.ts
import { test, expect } from 'bun:test';
import { buildSessionV2WsUrl } from './protocol';

test('https gateway -> wss session url', () => {
  const u = buildSessionV2WsUrl('https://gateway.lunel.dev', 'app', 'pw');
  expect(u.startsWith('wss://gateway.lunel.dev/v2/ws/app?')).toBe(true);
});

test('http localhost gateway -> ws session url (local relay)', () => {
  const u = buildSessionV2WsUrl('http://localhost:3000', 'cli', 'pw');
  expect(u.startsWith('ws://localhost:3000/v2/ws/cli?')).toBe(true);
});

test('already-wss gateway is preserved', () => {
  const u = buildSessionV2WsUrl('wss://gateway.lunel.dev', 'app', 'pw');
  expect(u.startsWith('wss://gateway.lunel.dev/v2/ws/app?')).toBe(true);
});

test('rejects a non-ws/wss/http/https scheme', () => {
  expect(() => buildSessionV2WsUrl('ftp://evil.com', 'app', 'pw')).toThrow();
});

test('includes generation when positive', () => {
  const u = buildSessionV2WsUrl('https://g.com', 'app', 'pw', 5);
  expect(u).toContain('generation=5');
});
