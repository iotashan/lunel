# Multi-Machine Switcher — Implementation Plan (tasks 60 / 70)

Validated by a parallel design workflow (4 independent Plan agents) against the
real code. This is the execute-ready spec for the multi-machine switcher. It is
the **large global app-state refactor**; it needs **on-device verification** for
two things tsc cannot catch (see Risks). Built on the completed direct
single-machine mode + task 80 (stream pause).

## Converged architecture (task 60)

Today (`app/app/_layout.tsx` `RootLayout`):
```
ConnectionProvider > ThemeProvider > AppSettingsProvider > ReviewPromptProvider
  > EditorProvider > PluginProvider > SessionRegistryProvider > RootLayoutContent
```
- **Device-global** (AsyncStorage-backed, no `useConnection`): Theme, AppSettings, Editor.
- **Per-machine** (own ws session / tabs): Connection, Plugin, SessionRegistry; ReviewPrompt consumes `useConnection` (AI events) so it is per-machine too.

New shape:
```
MachineRegistryProvider (GLOBAL) > Theme > AppSettings > Editor (GLOBAL)
  > MachineHost
      └─ for each machine: <MachineScope machineId active=…>
            ConnectionProvider > ReviewPromptProvider > PluginProvider > SessionRegistryProvider
            (active scope also renders <RootLayoutContent/>; inactive scopes stay
             mounted+hidden — warm sockets/tabs — but do NOT render the router)
```

Two new files + a `_layout` rewrite:
- **`app/contexts/MachineRegistry.tsx`** (new, global): `machines: MachineEntry[]`, `activeMachineId`, `addMachine(target,opts)→id`, `removeMachine(id)`, `setActive(id)`, `setLabel(id,label)`. Holds NO sockets — each `ConnectionProvider` still owns its socket. Starts EMPTY so a fresh launch matches today. `MachineEntry = { id, target: ConnectTarget, label, createdAt }`.
- **`app/components/MachineScope.tsx`** (new): wraps one machine's per-machine provider stack, keyed by `machineId`, mirroring `PluginRenderer.tsx`'s keep-mounted/hide-inactive pattern (absolute-fill + `opacity:0` + `pointerEvents="none"`, **never `display:none`** — Reanimated freezes refs under display:none). Contains a tiny `MachineAutoConnect` child inside `ConnectionProvider` that calls `connect(serialized target)` once on mount (guarded by a ref + status idle to survive StrictMode double-mount).
- **`app/contexts/ConnectionContext.tsx`**: `export` `parseConnectPayload` + `ConnectTarget` (currently private ~line 244) so the registry/lunel-connect build targets without re-parsing. Additive, zero new tsc errors.
- **`app/app/_layout.tsx`**: reorder providers per above; `lunel-connect` connect flow becomes `addMachine(target)→setActive`.

**N=1 backward-compat invariant:** when `machines.length <= 1`, the rendered tree under the global providers is exactly `Connection>ReviewPrompt>Plugin>SessionRegistry>RootLayoutContent` — no extra Views, no opacity/absolute layers. The multiplexing layers only appear at N≥2. This keeps the existing single-machine + relay flows byte-identical.

## Switcher UI (task 70)

- **`app/components/MachineSwitcher.tsx`** (new): lists machines labeled by `capabilities.hostname`/`rootDir` (known after connect; seed from scanned fqdn), active indicator, instant tap → `setActive` (pure visibility flip, sockets stay warm).
- Mount in **`DrawerContent.tsx`** (already hosts Home/Settings + the connection status dot).
- **Add machine**: route to `lunel-connect` to scan another direct QR → on success `addMachine`. **Remove machine**: tear down that scope (unmount triggers `ConnectionProvider`'s existing `cleanupSockets`), then `removeMachine` picks a new active or returns to `/auth`.
- The home screen (`app/app/(auth)/auth.tsx`, currently lists paired sessions) is the natural "machines" list too.

## Global-singleton isolation (REQUIRED for correctness — the hard part)

The ~30 `useConnection()` callers are context-based and re-parent cleanly under the active scope. But **five classes of module-level/global state alias across machines** and must be addressed:
1. **`app/lib/proxyServer.ts`** module singletons — *mitigated for v1*: direct mode skips proxy entirely (`directModeRef` gates `startPortServers`), so direct-only multi-machine never exercises it. Block a 2nd **relay** machine in `addMachine` for v1 (proxyServer is a hard singleton).
2. **`pluginRegistry` / `gPI`** (`app/plugins/*`) — plugin *definitions* are shared (fine); cross-plugin calls via `gPI` operate on the active plugin context. Verify `gPI` routes through context, not a captured singleton instance.
3. **Editor store singleton** — open files are per-machine; if it's a module singleton it aliases. Needs per-scope instance or machine-keyed state.
4. **`app/plugins/innerApi.ts`** — bottom-bar refresh singleton; re-point at the active machine on switch.
5. **`DrawerContent`** lives inside the active scope (good — its `useConnection` resolves to active), but confirm no module-level caches.

## Risks needing on-device verification (tsc can't catch)
- **Router re-parenting:** switching re-parents `<RootLayoutContent/>` (the expo-router Stack) under the newly-active scope. Must confirm React preserves (vs remounts) navigation state. If it remounts, fall back to a single global Stack + a context-bridge that selects the active machine's ConnectionContext (more invasive).
- **N warm connections cost:** N sockets + N reconnect/health loops. Direct mode already skips the manager health probe (helps). Cap machines (~8).
- **Singleton aliasing** (above) — behavioral, only visible with ≥2 machines live.

## Open questions (decide with running app)
- Bootstrap: empty registry until first connect (recommended — matches today) vs seed a placeholder.
- Workspace persistence keys (`@lunel_workspace`, `@lunel_bottom_bar`) — namespace per machineId for machines ≥2, leave machine #1 on legacy keys (back-compat).
- Remove-active-machine target (previous / next / none→/auth).

## Sequencing
1. Export `parseConnectPayload`/`ConnectTarget` (additive). 2. `MachineRegistry.tsx`. 3. `MachineScope.tsx` + `MachineAutoConnect`. 4. `_layout.tsx` rewrite (N=1 invariant first, verify tree identical). 5. `lunel-connect`/`auth` → registry. 6. Singleton isolation (1–5). 7. `MachineSwitcher.tsx` + DrawerContent. 8. On-device: pair 2 machines, switch, confirm isolation + navigation survives.
