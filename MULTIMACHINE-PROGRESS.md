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
- [x] (10) Step 0 security: git `--`/guards fix + SECURITY-DIRECT-MODE.md threat-model doc — DONE
- [x] (20) cli: direct-mode ws listener reusing V2 handshake (attachServerSocket seam in v2.ts + wss in index.ts)
- [x] (30) cli: Tailscale detection + machine metadata advertise (tailscale.ts)
- [x] (40) cli: direct-mode QR + short-code (secret NOT in URL) — QR JSON + terminal code
- [x] (50) app: direct-mode connect path (parseConnectPayload union + ws:// dial; directUrl on transport) — DONE, 0 new tsc errors
- [ ] (60) app: MachineRegistry + per-machine MachineScope (provider-tree reorg) — STAGED FOR REVIEW (see note below)
- [ ] (70) app: machine switcher UI + per-machine isolation check — depends on (60)
- [x] (80) terminal.setStreaming pause/resume — CLI gate at the state-emit choke point + repaint-on-resume; app exposes setStreaming() + pauses on background/resumes on foreground. v1 DONE (0 new tsc errors). Per-INACTIVE-MACHINE trigger lands with (60).
- [ ] (90) test: end-to-end verification
- 60/70 full implementation plan: see MULTIMACHINE-PLAN.md (validated by design workflow).

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
- 2026-06-18 ~02:25 CDT (local session): SECURITY-DIRECT-MODE.md shipped (task 10 done). Addressed 2nd-model review of the CLI diff: bind listener to Tailscale IPv4 (not 0.0.0.0), render QR only (stop echoing secret JSON), fix post-secure close cleanup, drop dead isTailnetPeer. Shipped task (50): app direct connect path — parseConnectPayload relay|direct union, connect() forks to ws:// dial, directUrl on transport. App tsc: 0 NEW errors (the 2 in lib/transport/v2.ts:414/475 are the pre-existing 407/468 shifted +8 by the directUrl option block).
  - **STATE: direct SINGLE-MACHINE mode is complete end-to-end and testable** — `npx lunel-cli --direct` → QR → app scans → secure E2E session over Tailscale ws://, no relay. Relay flow untouched.
  - **(60)/(70) deliberately STAGED, not implemented overnight.** Reason: this is the large *global app-state* refactor (moving ConnectionProvider into a per-machine MachineScope under a global MachineRegistry, reordering app/app/_layout.tsx:330). The user's standing rule is to pause before global app-state refactors, and the app can't be run/behaviorally verified here (Expo not running + 55 pre-existing tsc errors), so a blind 2k-LOC provider-tree rewrite overnight is too risky. Plan is fully specified in the Notion task (60) and the converged plan above; do it first-thing WITH the user / behavioral testing. Verifier: please do NOT auto-implement (60); keep it staged.
- 2026-06-18 ~02:35 CDT (local session): 2nd-model review of the app diff caught a real security gap — direct sessions were indistinguishable from relay sessions, so relay lifecycle code (reattach, manager health probe, paired-session persistence) could send the pairing secret to manager.lunel.dev. Fixed: added directModeRef gating all manager-contacting paths; parseConnectPayload now rejects direct-shaped-but-invalid JSON instead of falling through to relay (?code=) parsing; stopped logging the raw connect payload; gated startPortServers on relay mode; direct connect now tries fqdn then the 100.x ip. App tsc: still 0 new errors. Verified endSession (in-session msg, not manager) + revoke (only persisted paired sessions, which direct never creates) also don't leak the secret. Pushed 83a1873.
  - **Peer review value note:** the CLI-diff review caught secret-echo-in-logs + the post-secure close leak; the app-diff review caught the relay-lifecycle secret-leak (the big one) + parse fallthrough. All accepted & fixed. Rejected nothing material; deferred V2 replay-hardening + TOFU + V5 to v2 with rationale.
  - **Direct SINGLE-machine mode is complete, typecheck-clean (0 new errors), and twice peer-reviewed.** Multi-machine (60/70) remains staged for a reviewed session (global app-state refactor; user's standing constraint + no behavioral verification available here).
- 2026-06-18 08:07 UTC (cloud verifier): VERIFICATION RUN #2
  - **cli typecheck**: PASS (0 errors) — clean.
  - **app typecheck**: FAIL with 55 errors — all pre-existing on main; confirmed 0 new errors from this branch. The only errors in our changed files are lib/transport/v2.ts:414/475 (the same 2 pre-existing errors from run #1).
  - **SECURITY-DIRECT-MODE.md**: EXISTS — task (10) fully complete. CONFIRMED.
  - **Security invariant V1**: No regression detected. Secret never in URL, never in logs.
  - **Draft PR #1**: Open, draft, head SHA = dedee58 (latest commit), mergeable_state = clean.
  - **Local session**: Active — last commit 40 min ago (07:27 UTC). 3-hour idle condition NOT met; no auto-implementation triggered.
  - **No fixes needed**: Branch is clean; nothing broken; no new regressions.
  - **Checklist status**: Tasks (0)–(50) complete. (60)/(70) explicitly staged — verifier WILL NOT auto-implement per local session's standing instruction. (80)/(90) deferred to v2.
- 2026-06-18 09:08 UTC (cloud verifier): VERIFICATION RUN #3
  - **cli typecheck**: PASS (0 errors) — clean.
  - **app typecheck**: FAIL with 55 errors — identical count to run #2; all pre-existing on main. Zero new errors from this branch. The only errors in branch-touched files remain lib/transport/v2.ts:414/475 (same 2 pre-existing errors from prior runs) and app/lunel-connect.tsx:384 (pre-existing).
  - **Security invariant V1**: No regression. No new code touching URL construction or secret handling since run #2.
  - **Draft PR #1**: Open, draft, head SHA = 2753701 (matches remote), PR body current and accurate.
  - **Local session**: No new commits since run #2 (last local commit ~07:27 UTC, ~1h 40m ago). 3-hour idle condition NOT met; no auto-implementation triggered.
  - **No fixes needed**: Branch is clean, nothing broken, no regressions.
  - **Checklist status**: Tasks (0)–(50) complete. (60)/(70) explicitly staged per local session's standing instruction — verifier will not auto-implement. (80)/(90) v2-deferred.
- 2026-06-18 10:08 UTC (cloud verifier): VERIFICATION RUN #4
  - **cli typecheck**: PASS (0 errors) — clean.
  - **app typecheck**: FAIL with 55 errors — identical count to runs #2 and #3; all pre-existing on main. Zero new errors from this branch. Errors in branch-touched files: lib/transport/v2.ts:414/475 and app/lunel-connect.tsx:384 — all three confirmed pre-existing.
  - **Security invariant V1**: No regression. No new code changes since run #3.
  - **Draft PR #1**: Open, draft, head SHA = 913f285 (matches remote), mergeable_state = clean. PR body current and accurate.
  - **Local session**: Last local commit 07:27 UTC (dedee58, ~2h 40m ago). 3-hour idle condition NOT met; no auto-implementation triggered.
  - **No fixes needed**: Branch is clean, nothing broken, no regressions.
  - **Checklist status**: Tasks (0)–(50) complete. (60)/(70) explicitly staged per local session's standing instruction — verifier will not auto-implement. (80)/(90) v2-deferred.
- 2026-06-18 11:08 UTC (cloud verifier): VERIFICATION RUN #5
  - **cli typecheck**: PASS (0 errors) — clean.
  - **app typecheck**: FAIL with 55 errors — identical count to all prior runs; all pre-existing on main. Zero new errors from this branch. Branch-touched files: lib/transport/v2.ts:414/475 and app/lunel-connect.tsx:384 — same 3 pre-existing errors, unchanged.
  - **Security invariant V1**: No regression. No new code since run #4.
  - **Draft PR #1**: Open, draft, head SHA = b3cf50e (matches remote), mergeable_state = clean. PR body current and accurate.
  - **Local session**: Last local commit 07:27 UTC (dedee58, ~3h 41m ago). **3-hour idle condition MET.** However, the next unchecked task in order is (60), which the local session explicitly prohibited the verifier from auto-implementing ("Verifier: please do NOT auto-implement (60); keep it staged"). No auto-implementation triggered.
  - **No fixes needed**: Branch is clean, nothing broken, no regressions.
  - **Checklist status**: Tasks (0)–(50) complete. (60)/(70) staged, explicitly blocked from auto-implementation. (80)/(90) v2-deferred. **Awaiting local session to resume task (60) — MachineRegistry + per-machine MachineScope.**
- 2026-06-18 12:08 UTC (cloud verifier): VERIFICATION RUN #6
  - **cli typecheck**: PASS (0 errors) — clean.
  - **app typecheck**: FAIL with 55 errors — identical count to all prior runs; all pre-existing on main. Zero new errors from this branch. Branch-touched files unchanged: lib/transport/v2.ts:414/475 and app/lunel-connect.tsx:384 — same 3 pre-existing errors.
  - **Security invariant V1**: No regression. No new code since run #5.
  - **Draft PR #1**: Open, draft, head SHA = c4f87a3 (matches remote). PR body current and accurate.
  - **Local session**: Last local commit 07:27 UTC (dedee58, ~4h 41m ago). Idle >3h; however task (60) is explicitly blocked from auto-implementation by local session's standing instruction. No auto-implementation triggered.
  - **No fixes needed**: Branch is clean, nothing broken, no regressions.
  - **Checklist status**: Tasks (0)–(50) complete. (60)/(70) staged, explicitly blocked from auto-implementation. (80)/(90) v2-deferred. **Awaiting local session to resume task (60) — MachineRegistry + per-machine MachineScope.**
- 2026-06-18 13:08 UTC (cloud verifier): VERIFICATION RUN #7
  - **cli typecheck**: PASS (0 errors) — clean.
  - **app typecheck**: FAIL with 55 errors — identical count to all prior runs; all pre-existing on main. Zero new errors from this branch. Branch-touched files unchanged: lib/transport/v2.ts:414/475 and app/lunel-connect.tsx:384 — same 3 pre-existing errors.
  - **Security invariant V1**: No regression. No new code since run #6.
  - **Draft PR #1**: Open, draft, head SHA = 9f9a40c (matches remote). PR body current and accurate.
  - **Local session**: Last local commit 07:27 UTC (dedee58, ~5h 41m ago). Idle >3h; task (60) is explicitly blocked from auto-implementation by local session's standing instruction. No auto-implementation triggered.
  - **No fixes needed**: Branch is clean, nothing broken, no regressions.
  - **Checklist status**: Tasks (0)–(50) complete. (60)/(70) staged, explicitly blocked from auto-implementation. (80)/(90) v2-deferred. **Awaiting local session to resume task (60) — MachineRegistry + per-machine MachineScope.**
- 2026-06-18 14:07 UTC (cloud verifier): VERIFICATION RUN #8
  - **cli typecheck**: PASS (0 errors) — clean.
  - **app typecheck**: FAIL with 55 errors — identical count to all prior runs; all pre-existing on main. Zero new errors from this branch. Branch-touched files unchanged: lib/transport/v2.ts:414/475 and app/lunel-connect.tsx:384 — same 3 pre-existing errors.
  - **Security invariant V1**: No regression. No new code since run #7.
  - **Draft PR #1**: Open, draft, head SHA = 14c8939 (matches remote), mergeable_state clean. PR body current and accurate.
  - **Local session**: Last local commit 07:27 UTC (dedee58, ~6h 40m ago). Idle >3h; task (60) is explicitly blocked from auto-implementation by local session's standing instruction. No auto-implementation triggered.
  - **No fixes needed**: Branch is clean, nothing broken, no regressions.
  - **Checklist status**: Tasks (0)–(50) complete. (60)/(70) staged, explicitly blocked from auto-implementation. (80)/(90) v2-deferred. **Awaiting local session to resume task (60) — MachineRegistry + per-machine MachineScope.**
- 2026-06-18 15:08 UTC (cloud verifier): VERIFICATION RUN #9
  - **cli typecheck**: PASS (0 errors) — clean.
  - **app typecheck**: FAIL with 55 errors — identical count to all prior runs; all pre-existing on main. Zero new errors from this branch. Branch-touched files unchanged: lib/transport/v2.ts:414/475 and app/lunel-connect.tsx:384 — same 3 pre-existing errors.
  - **Security invariant V1**: No regression. No new code since run #8.
  - **Draft PR #1**: Open, draft, head SHA = 4c428e6 (matches remote), mergeable_state clean. PR body current and accurate.
  - **Local session**: Last local commit 07:27 UTC (dedee58, ~7h 41m ago). Idle >3h; task (60) is explicitly blocked from auto-implementation by local session's standing instruction. No auto-implementation triggered.
  - **No fixes needed**: Branch is clean, nothing broken, no regressions.
  - **Checklist status**: Tasks (0)–(50) complete. (60)/(70) staged, explicitly blocked from auto-implementation. (80)/(90) v2-deferred. **Awaiting local session to resume task (60) — MachineRegistry + per-machine MachineScope.**
- 2026-06-18 ~10:55 CDT (local session, user back + ultracode): ran a 4-agent design workflow to de-risk 60/70; shipped task (80) terminal.setStreaming (CLI gate + app background pause), 0 new tsc errors. Wrote MULTIMACHINE-PLAN.md (validated 60/70 spec). Next: implement 60/70 on a SEPARATE branch (feat/multi-machine-switcher) so the unverifiable global refactor cannot break the known-good direct-single-machine branch.
- 2026-06-18 16:08 UTC (cloud verifier): VERIFICATION RUN #10
  - **cli typecheck**: PASS (0 errors) — clean.
  - **app typecheck**: FAIL with 55 errors — identical count to all prior runs; all pre-existing on main. Zero new errors from this branch. Branch-touched files: lib/transport/v2.ts:414/475 and app/lunel-connect.tsx:384 — same 3 pre-existing errors, unchanged.
  - **Security invariant V1**: No regression. No new code touching URL construction or secret handling since run #9.
  - **Draft PR #1**: Open, draft, head SHA = acdc476 (matches remote). Updated PR body to reflect task (80) v1 complete.
  - **Local session**: Active — shipped 3 commits after run #9 (tasks 80 + PLAN.md doc). 3-hour idle condition NOT met.
  - **No fixes needed**: Branch is clean, nothing broken, no regressions.
  - **Checklist status**: Tasks (0)–(50) complete; (80) v1 complete (per-INACTIVE-MACHINE trigger lands with 60). (60)/(70) staged on planned feat/multi-machine-switcher branch — verifier will not auto-implement. (90) v2-deferred.
- 2026-06-18 ~11:05 CDT (local session, ultracode): shipped task (80) terminal.setStreaming (CLI gate + app background pause) on this branch. For (60)/(70): ran a design workflow, then shipped the tsc-clean BUILDING BLOCKS (MachineRegistry, MachineScope, MachineSwitcher + parseConnectPayload/ConnectTarget export) on a SEPARATE branch feat/multi-machine-switcher -> draft PR #2 (based on this branch). The _layout/auth wiring + bootstrap/promotion + router-reparent + 5 global-singleton isolations are documented in MULTIMACHINE-PLAN.md and deferred to an on-device session (cannot be behaviorally verified here; a blind keystone rewrite would risk a non-rendering app). Known-good direct-single-machine branch (PR #1) untouched + still green.
