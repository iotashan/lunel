// Pure, dependency-free connection-target + gateway-URL logic.
//
// This is the security trust boundary that decides (a) whether the session
// secret can travel over plaintext and (b) whether a foreign host may be dialed.
// It is deliberately kept free of react-native / expo imports so it can be unit
// tested directly (see connectTarget.test.ts). Do NOT add RN/Expo imports here.

export type ConnectTarget =
  | { kind: 'relay'; code: string }
  | { kind: 'direct'; fqdn: string; port: number; secret: string; ip?: string };

export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

// Normalises a gateway URL to a ws/wss form. Plaintext ws:// / http:// is allowed
// ONLY for genuine loopback hosts (local relay testing); any real host must use
// wss://. Empty input returns the provided default.
export function normalizeGateway(input: string, defaultGateway: string): string {
  const raw = input.trim();
  if (!raw) return defaultGateway;

  const lower = raw.toLowerCase();
  const insecure = lower.startsWith('ws://') || lower.startsWith('http://');
  const parseable = /^[a-z]+:\/\//i.test(raw) ? raw : `wss://${raw}`;
  let probe: URL;
  try { probe = new URL(parseable); } catch { throw new Error('Invalid gateway URL'); }

  if (insecure) {
    if (!isLocalHostname(probe.hostname)) {
      throw new Error('Insecure gateway protocol is not allowed; use wss:// or https://');
    }
    const lpath = probe.pathname === '/' ? '' : probe.pathname.replace(/\/+$/, '');
    return `ws://${probe.host}${lpath}`;
  }

  const asWss = lower.startsWith('https://')
    ? `wss://${raw.slice(8)}`
    : lower.startsWith('wss://')
      ? raw
      : `wss://${raw}`;

  try {
    const url = new URL(asWss);
    if (url.protocol !== 'wss:') {
      throw new Error('invalid protocol');
    }
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    throw new Error('Invalid gateway URL');
  }
}

export function parseConnectPayload(value: string): ConnectTarget {
  const raw = value.trim();
  if (!raw) return { kind: 'relay', code: '' };

  // Direct (Tailscale) pairing QR is JSON: {v,mode:'direct',fqdn,port,secret,ip?}
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      // If it's direct-shaped at all, never fall through to relay parsing — that
      // would push a secret-bearing string into the manager's ?code= query.
      const looksDirect = obj.mode === 'direct' || typeof obj.secret === 'string';
      if (looksDirect) {
        if (
          obj.mode === 'direct' &&
          typeof obj.secret === 'string' &&
          typeof obj.port === 'number' &&
          (typeof obj.fqdn === 'string' || typeof obj.ip === 'string')
        ) {
          return {
            kind: 'direct',
            fqdn: typeof obj.fqdn === 'string' ? obj.fqdn : '',
            port: obj.port,
            secret: obj.secret,
            ip: typeof obj.ip === 'string' ? obj.ip : undefined,
          };
        }
        // Direct-shaped but malformed/version-skewed: reject as invalid rather
        // than leaking the secret to the relay.
        return { kind: 'relay', code: '' };
      }
    } catch {
      // not JSON; fall through to relay parsing
    }
  }

  const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const code = parts[parts.length - 1];
    return { kind: 'relay', code };
  }

  // Support URL payloads, e.g. lunel://connect?code=ABC or https://.../ABC
  try {
    const url = new URL(raw);
    const queryCode = url.searchParams.get('code')?.trim();
    if (queryCode) return { kind: 'relay', code: queryCode };

    const pathCode = url.pathname.split('/').filter(Boolean).pop()?.trim();
    if (pathCode) return { kind: 'relay', code: pathCode };
  } catch {
    // ignore URL parsing failures and continue with fallback parsing
  }

  // Support plain text containing "...code=ABC..."
  const queryMatch = raw.match(/(?:^|[?&#,\s])code=([^&#,\s]+)/i);
  if (queryMatch?.[1]) {
    return { kind: 'relay', code: decodeURIComponent(queryMatch[1]).trim() };
  }

  return { kind: 'relay', code: raw };
}
