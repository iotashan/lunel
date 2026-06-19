import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';
import type { ConnectTarget } from '@/contexts/ConnectionContext';

// A paired developer machine. The registry holds NO sockets — each machine's
// own <ConnectionProvider> (a per-machine ConnectionHolder in MachineConnections)
// owns the ws session. The registry only tracks the set of machines, which is
// active, and how to (re)dial.
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
  /** Returns the new machine id, or null if rejected (e.g. a 2nd relay machine). */
  addMachine: (target: ConnectTarget, opts?: { activate?: boolean; label?: string }) => string | null;
  /** Record a machine's target/mode (e.g. the seeded primary once it connects). */
  setMachineTarget: (id: string, target: ConnectTarget) => void;
  removeMachine: (id: string) => void;
  setActive: (id: string) => void;
  /** Update a machine's display label (e.g. once capabilities.hostname is known). */
  setLabel: (id: string, label: string) => void;
  /** True while pairing an ADDITIONAL machine (vs the primary). Source of truth for
   * the connect screen — replaces a fragile route param across the drawer->stack push. */
  addMode: boolean;
  beginAdd: () => void;
  endAdd: () => void;
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
  const [addMode, setAddMode] = useState(false);
  // Mirror of machines for identity-stable callbacks (avoids re-creating
  // removeMachine on every list change, which would bust the value memo).
  const machinesRef = useRef(machines);
  machinesRef.current = machines;

  const addMachine = useCallback(
    (target: ConnectTarget, opts?: { activate?: boolean; label?: string }): string | null => {
      // Only ONE relay machine is allowed: the port-forwarding proxy is a single
      // process-global, so a 2nd relay would clobber/misroute the first's tunnels
      // (and teardown is global). Direct (Tailscale) machines bypass the proxy
      // entirely (directModeRef-gated) and are unlimited.
      if (target.kind === 'relay' && machinesRef.current.some((m) => m.target?.kind === 'relay')) {
        return null;
      }
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
    // one (primary is permanent, so there is always a fallback).
    setActiveMachineId((cur) => {
      if (cur !== id) return cur;
      const remaining = machinesRef.current.filter((m) => m.id !== id);
      return remaining.length ? remaining[remaining.length - 1].id : PRIMARY_MACHINE_ID;
    });
  }, []);

  const setActive = useCallback((id: string) => setActiveMachineId(id), []);

  const beginAdd = useCallback(() => setAddMode(true), []);
  const endAdd = useCallback(() => setAddMode(false), []);

  const setLabel = useCallback((id: string, label: string) => {
    setMachines((prev) => prev.map((m) => (m.id === id ? { ...m, label } : m)));
  }, []);

  const setMachineTarget = useCallback((id: string, target: ConnectTarget) => {
    setMachines((prev) => prev.map((m) => (m.id === id ? { ...m, target } : m)));
  }, []);

  const value = useMemo<MachineRegistryContextType>(
    () => ({ machines, activeMachineId, addMachine, removeMachine, setActive, setLabel, setMachineTarget, addMode, beginAdd, endAdd }),
    [machines, activeMachineId, addMachine, removeMachine, setActive, setLabel, setMachineTarget, addMode, beginAdd, endAdd],
  );

  return <MachineRegistryContext.Provider value={value}>{children}</MachineRegistryContext.Provider>;
}

export function useMachineRegistry(): MachineRegistryContextType {
  const ctx = useContext(MachineRegistryContext);
  if (!ctx) throw new Error('useMachineRegistry must be used within MachineRegistryProvider');
  return ctx;
}
