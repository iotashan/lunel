# Direct (Tailscale) Mode — Threat Model & Security Decisions

This documents the security review that gated the multi-machine direct-connection
feature, and the decisions baked into the implementation. Reviewed by a full
codebase audit + an independent second-model pass.

## Threat model

- The relay (`proxy`/`manager`) is **untrusted**; confidentiality + integrity rest
  entirely on the E2E handshake in `cli/src/transport/v2.ts` (X25519 +
  XChaCha20-Poly1305).
- In **direct mode** there is no relay: the phone dials the CLI's `ws://` listener
  on the **Tailscale** interface. The link is "plaintext ws://" at the socket layer
  but **WireGuard-encrypted node-to-node by Tailscale** on the wire. So a passive
  network sniffer off-tailnet sees nothing; the residual threats are a **compromised
  tailnet node**, an on-host process, or local logs.
- Once the E2E channel is secure, the phone is *intended* to have fs / git / terminal
  (PTY) / process / port authority on the machine. That is by design and gated behind
  the secure channel; it is not a vuln.

## Findings & verdicts (audit + second-model peer review)

| # | Finding | Verdict | Action |
|---|---------|---------|--------|
| **V1** | Session password rides cleartext in the ws upgrade URL (`?password=`) and equals the handshake auth key. Dropping TLS would leak full peer authority. | **Confirmed — critical for this feature.** | **Fixed by design:** direct mode dials a **credential-free** `ws://fqdn:port` (no `?password=`). The secret authenticates *inside* the encrypted handshake (auth tag over `H(secret)`). Secret never logged. |
| **V2** | `server_ready` auth tag not transcript-bound; no per-message sequence → captured ciphertext frames replayable within a session. | Confirmed vs untrusted relay/MITM; **not** meaningful vs an authenticated peer (it already has RCE). | **Deferred to v2.** Tailscale's WireGuard prevents on-path replay off a compromised node. Upgrade path: bind `server_ready` to the transcript + add per-direction sequence numbers (or `secretstream`). |
| **V3** | Pairing trust = QR code alone; manager hands the password to whichever app connects first → race/shoulder-surf. | Confirmed. | **Avoided in direct mode:** no manager assemble — the CLI generates the secret and puts it in the QR. (Relay pairing unchanged for v1.) |
| **V4** | `git diff`/`checkout`/`branch -d` pass remote path/ref without `--` → git option injection escapes the `ROOT_DIR` jail. | Confirmed (cheap hardening). | **Fixed:** `--` separator on diff path; leading-`-` guards on branch ops. (commit `b74f128`) |
| **V5** | `http.request` fetches arbitrary remote-supplied URLs → SSRF to metadata/localhost. | Confirmed mechanically; low ROI under the RCE-by-design model. | **Deferred to v2.** Optional: block link-local/metadata ranges; allow loopback explicitly (dev inspection). |
| **TOFU** | Pin the peer's key on first pairing. | — | **Deferred.** Pinning ephemeral transport keys is worse than none; real TOFU needs stable device identity keys + rotation UX. |

## Direct-mode auth flow (implemented)

1. CLI (`--direct`) detects Tailscale, generates a 32-byte random `secret`, binds a
   `ws` server on an ephemeral port, and prints a QR encoding
   `{v:1, mode:"direct", fqdn, port, secret, ip?}` (JSON) + a manual short-code.
2. App dials `ws://fqdn:port` — **no secret/password in the URL or query**.
3. CLI listener emits a `peer_connected` system frame → app starts the handshake.
4. App `client_hello` → CLI `server_hello` → app `client_key` with
   `auth = MAC(H(secret), …)` → CLI verifies the MAC before accepting → CLI
   `server_ready` → both `markSecure`. A wrong/absent secret fails the MAC and the
   session never goes secure. Handshake has a timeout; one app connection per machine
   for v1.

## Invariants to preserve (enforce on review)

- The direct-mode secret MUST NOT appear in any URL/query string or log.
- The existing relay flow (`gateway.lunel.dev`) and the E2E crypto are unchanged.
- No new TLS/cert provisioning — iOS ATS for `ws://` is handled out-of-band
  (scheduled TestFlight builds).
