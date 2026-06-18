import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  ConnectionProvider,
  ConnectionContext,
  useConnection,
  fallbackConnectionContext,
  type ConnectionContextType,
  type ConnectTarget,
} from '@/contexts/ConnectionContext';
import { useMachineRegistry, serializeTarget } from '@/contexts/MachineRegistry';
import { logger } from '@/lib/logger';

// Multi-session layer. Each paired machine gets its own <ConnectionProvider>
// (warm socket) mounted once via a hidden ConnectionHolder; that holder publishes
// its live context value into this store. A single <ActiveConnectionProvider>
// re-provides the ACTIVE machine's value to the (single, never-reparented) router.
// Switching machines = setActive() -> the store notifies -> the router re-renders
// against the new connection, with no remount of the router or providers.
// ponytail: per-machine PLUGIN/UI state (terminal scrollback, tabs) is NOT yet
// scoped per machine — only the connections are. Upgrade PluginProvider/panels to
// machine-keyed stores when warm per-machine UI state is needed.

type Listener = () => void;

const connStore = {
  values: new Map<string, ConnectionContextType>(),
  listeners: new Map<string, Set<Listener>>(),
  set(id: string, v: ConnectionContextType) {
    this.values.set(id, v);
    this.listeners.get(id)?.forEach((l) => l());
  },
  remove(id: string) {
    this.values.delete(id);
    this.listeners.get(id)?.forEach((l) => l());
  },
  get(id: string | null): ConnectionContextType | undefined {
    return id ? this.values.get(id) : undefined;
  },
  subscribe(id: string | null, l: Listener): () => void {
    if (!id) return () => {};
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(l);
    return () => {
      set!.delete(l);
    };
  },
};

// Lives inside ONE machine's <ConnectionProvider>. Publishes that connection's
// value to the store and auto-dials the target once (machines with a target are
// the non-primary ones added via the switcher). Renders nothing.
function ConnectionPublisher({ machineId, target }: { machineId: string; target: ConnectTarget | null }) {
  const conn = useConnection();
  // Publish the latest value after every commit of this holder (the holder only
  // re-renders on connection STATE changes, so this is not a per-frame firehose).
  useEffect(() => {
    connStore.set(machineId, conn);
  });
  useEffect(() => () => connStore.remove(machineId), [machineId]);

  const didConnect = useRef(false);
  useEffect(() => {
    if (!target || didConnect.current) return;
    didConnect.current = true;
    void conn.connect(serializeTarget(target)).catch((err) => {
      logger.error('machine', 'auto-connect failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return null;
}

// One warm connection per machine. Mounted once, never wraps the router, so it is
// never reparented when the active machine changes.
export function ConnectionHolder({ machineId, target }: { machineId: string; target: ConnectTarget | null }) {
  return (
    <ConnectionProvider>
      <ConnectionPublisher machineId={machineId} target={target} />
    </ConnectionProvider>
  );
}

// Re-provides the active machine's connection to the router via the same
// ConnectionContext, so every existing useConnection() consumer is unchanged.
export function ActiveConnectionProvider({ children }: { children: React.ReactNode }) {
  const { activeMachineId } = useMachineRegistry();
  const value = useSyncExternalStore(
    useCallback((cb: Listener) => connStore.subscribe(activeMachineId, cb), [activeMachineId]),
    () => connStore.get(activeMachineId) ?? fallbackConnectionContext,
  );
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}
