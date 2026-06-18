import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { ConnectTarget } from '@/contexts/ConnectionContext';

// A paired developer machine. The registry holds NO sockets — each machine's
// own <ConnectionProvider> (inside its <MachineScope>) owns the ws session. The
// registry only tracks the set of machines, which is active, and how to (re)dial.
export interface MachineEntry {
  id: string;
  // null for the seeded "primary" machine before the user has paired it — its
  // scope provides a ConnectionProvider for the pre-connect screens (auth/connect)
  // and does NOT auto-connect; connect()/resume run on it directly like today.
  target: ConnectTarget | null;
  label: string;
  createdAt: number;
}

// The always-present first machine. Seeding it keeps machines.length >= 1, so the
// rendered tree at N=1 is exactly today's (one ConnectionProvider) with no
// remount when the user pairs (the scope's key never changes).
export const PRIMARY_MACHINE_ID = 'primary';

interface MachineRegistryContextType {
  machines: MachineEntry[];
  activeMachineId: string | null;
  /** Register a machine from a parsed connect payload. Returns its id. */
  addMachine: (target: ConnectTarget, opts?: { activate?: boolean; label?: string }) => string;
  removeMachine: (id: string) => void;
  setActive: (id: string) => void;
  /** Update a machine's display label (e.g. once capabilities.hostname is known). */
  setLabel: (id: string, label: string) => void;
}

// Bound memory: each machine keeps a warm socket + plugin subtree.
const MAX_MACHINES = 8;

function defaultLabel(target: ConnectTarget): string {
  if (target.kind === 'direct') return target.fqdn || target.ip || 'Machine';
  return 'Machine';
}

let machineSeq = 0;
function genMachineId(): string {
  machineSeq += 1;
  return `machine-${Date.now().toString(36)}-${machineSeq}`;
}

/** Re-serialize a target back into the string `connect()` accepts. */
export function serializeTarget(target: ConnectTarget): string {
  if (target.kind === 'direct') {
    return JSON.stringify({
      v: 1,
      mode: 'direct',
      fqdn: target.fqdn,
      port: target.port,
      secret: target.secret,
      ...(target.ip ? { ip: target.ip } : {}),
    });
  }
  return target.code;
}

const MachineRegistryContext = createContext<MachineRegistryContextType | null>(null);

export function MachineRegistryProvider({ children }: { children: React.ReactNode }) {
  const [machines, setMachines] = useState<MachineEntry[]>([
    { id: PRIMARY_MACHINE_ID, target: null, label: 'This machine', createdAt: Date.now() },
  ]);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(PRIMARY_MACHINE_ID);

  const addMachine = useCallback(
    (target: ConnectTarget, opts?: { activate?: boolean; label?: string }) => {
      const id = genMachineId();
      const entry: MachineEntry = {
        id,
        target,
        label: opts?.label ?? defaultLabel(target),
        createdAt: Date.now(),
      };
      setMachines((prev) => (prev.length >= MAX_MACHINES ? prev : [...prev, entry]));
      if (opts?.activate !== false) setActiveMachineId(id);
      return id;
    },
    [],
  );

  const removeMachine = useCallback((id: string) => {
    if (id === PRIMARY_MACHINE_ID) return; // the primary machine is permanent
    setMachines((prev) => prev.filter((m) => m.id !== id));
    // If we removed the active machine, fall back to the most recent remaining
    // one (or null → back to the connect/auth screen). Computed from the current
    // list rather than nesting a setter inside the setMachines updater.
    setActiveMachineId((cur) => {
      if (cur !== id) return cur;
      const remaining = machines.filter((m) => m.id !== id);
      return remaining.length ? remaining[remaining.length - 1].id : null;
    });
  }, [machines]);

  const setActive = useCallback((id: string) => setActiveMachineId(id), []);

  const setLabel = useCallback((id: string, label: string) => {
    setMachines((prev) => prev.map((m) => (m.id === id ? { ...m, label } : m)));
  }, []);

  const value = useMemo<MachineRegistryContextType>(
    () => ({ machines, activeMachineId, addMachine, removeMachine, setActive, setLabel }),
    [machines, activeMachineId, addMachine, removeMachine, setActive, setLabel],
  );

  return <MachineRegistryContext.Provider value={value}>{children}</MachineRegistryContext.Provider>;
}

export function useMachineRegistry(): MachineRegistryContextType {
  const ctx = useContext(MachineRegistryContext);
  if (!ctx) throw new Error('useMachineRegistry must be used within MachineRegistryProvider');
  return ctx;
}
