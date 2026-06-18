# Multi-Machine Direct (Tailscale) — Progress

Shared tracker for the local session + the hourly cloud routine. Read first, update last. Branch: `feat/multi-machine-direct`.

## Mission
One mobile client → MULTIPLE dev machines at once, instant switching. New mode: phone connects DIRECTLY to each machine over Tailscale (plaintext ws:// to MagicDNS name), NO relay. Additive — existing gateway.lunel.dev relay flow stays as fallback. No TLS; rely on E2E (libsodium X25519 + XChaCha20-Poly1305).

## Security guardrails (from the audit — do not regress)
- **V1 (critical):** the session password rides cleartext in the ws upgrade URL `?password=` AND is the handshake auth key. Direct mode MUST NOT put the secret in the URL — prove it inside the encrypted 4-frame handshake (the auth tag already mixes H(secret)). The relay-mode URL password is only needed because the *relay* gates on it; a direct CLI listener gates inside the handshake.
- **V4 (fixed):** git arg-injection — `--` separator before diff path; leading-`-` guard on branch ops. ✅ done.
- V2 (replay), V3 (pairing race), V5 (http.request SSRF), TOFU peer-pinning: evaluate, defer to v2 unless cheap. Record decisions in SECURITY-DIRECT-MODE.md.

## Architecture decision (CONVERGED — me + Codex independently)
App: (a) global `MachineRegistryProvider` (machine list + activeMachineId) + one per-machine `MachineScope` (Connection/ReviewPrompt/Plugin/SessionRegistry INSIDE scope; Theme/AppSettings/Editor global). Reuse `app/components/PluginRenderer.tsx` keep-mounted/hide-inactive pattern. Do NOT thread machineId through ~30 hooks.

## Verified facts (trust these; cited)
- E2E handshake transport-agnostic; app=initiator (client_hello), cli=responder (server_hello) → roles map 1:1 over a direct socket, NO crypto change. (cli/src/transport/v2.ts:270-395)
- App connection is a hard singleton: one ConnectionProvider at app/app/_layout.tsx:330. ~30 useConnection() callers.
- Only relay-coupled seam in connect: parseConnectPayload() at app/contexts/ConnectionContext.tsx:242 → assembleWithCode() → getAssignedProxyUrl(). Fork there for direct mode.
- SessionRegistry = plugin tabs, NOT machines.
- Protocol has NO pause primitive; PTY output = ns:terminal/action:output events.
- Reuse existing `ws` dep in cli (no new dep).

## Task checklist (Notion milestone "M1 — Multi-Machine Direct (Tailscale)")
- [x] (10) Step 0 security: git `--`/guards fix committed; threat model doc — IN PROGRESS (fix done, doc pending)
- [x] (20) cli: direct-mode ws listener reusing V2 handshake (attachServerSocket seam in v2.ts + wss in index.ts)
- [x] (30) cli: Tailscale detection + machine metadata advertise (tailscale.ts)
- [x] (40) cli: direct-mode QR + short-code (secret NOT in URL) — QR JSON + terminal code
- [ ] (50) app: direct-mode connect path (parseConnectPayload + ws:// dial)
- [ ] (60) app: MachineRegistry + per-machine MachineScope (provider-tree reorg)
- [ ] (70) app: machine switcher UI + per-machine isolation check
- [ ] (80) protocol: backgrounded stream pause/resume (v2-deferrable)
- [ ] (90) test: end-to-end verification

## Log
- 2026-06-18 ~01:52 CDT (local session): branch created; Notion project "Lunel Multi-Machine" + 9 tasks under milestone M1; V4 git fix applied. Next: commit + push + draft PR, then cli direct listener.
- 2026-06-18 ~02:01 CDT (local session): shipped 3 CLI commits — Tailscale detection (tailscale.ts), `--direct` ws listener + QR (index.ts), `attachServerSocket` seam on V2 transport (v2.ts). Tasks (20), (30), (40) substantially done.
- 2026-06-18 07:05 UTC (cloud verifier): VERIFICATION RUN #1 (rebased after local session push)
  - **cli typecheck**: PASS (zero errors) — including all 3 new commits
  - **app typecheck**: FAIL — ALL errors are pre-existing on main; diff shows zero new errors from this branch. Not a regression.
  - **Draft PR**: #1 open and current (https://github.com/iotashan/lunel/pull/1)
  - **Security invariant V1**: CONFIRMED. `startDirectMode()` binds `WebSocketServer` with no URL credential; secret flows as `sessionSecret` into the V2 handshake only. WS upgrade URL is credential-free. QR carries secret in a scanned JSON blob (not a URL query string). Code display on terminal is the intended manual-pairing short-code.
  - **Gaps/notes for local session**:
    - SECURITY-DIRECT-MODE.md (threat model doc) still missing — task (10) not done until this file exists.
    - `console.log(\`Code: \${secret}\`)` (index.ts ~3627): secret printed to terminal for manual pairing — acceptable, but consider redacting from any future structured debug logs.
    - app typecheck has ~80 pre-existing errors on main; when writing new app code for tasks (50)-(70), aim not to increase that count.
    - `lib/transport/v2.ts` lines 407 and 468 have two pre-existing null/undefined errors — be aware when touching that file.
    - Tasks remaining: (50) app direct-mode connect path, (60) MachineRegistry + MachineScope, (70) machine switcher UI, (80) pause/resume (v2-deferrable), (90) E2E test.
