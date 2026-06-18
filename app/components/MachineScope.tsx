import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { ConnectionProvider, useConnection } from '@/contexts/ConnectionContext';
import type { ConnectTarget } from '@/contexts/ConnectionContext';
import { ReviewPromptProvider } from '@/contexts/ReviewPromptContext';
import { SessionRegistryProvider } from '@/contexts/SessionRegistry';
import { PluginProvider } from '@/plugins';
import { serializeTarget } from '@/contexts/MachineRegistry';
import { logger } from '@/lib/logger';

// Dials this machine's target exactly once after its own ConnectionProvider
// mounts. The ref guard survives StrictMode's double-mount so we never open two
// sockets for one machine.
function MachineAutoConnect({ target }: { target: ConnectTarget }) {
  const { connect } = useConnection();
  const didConnectRef = useRef(false);
  useEffect(() => {
    if (didConnectRef.current) return;
    didConnectRef.current = true;
    void connect(serializeTarget(target)).catch((err) => {
      logger.error('machine', 'auto-connect failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, [connect, target]);
  return null;
}

/**
 * Wraps ONE machine's per-machine provider stack (Connection > ReviewPrompt >
 * Plugin > SessionRegistry — the same relative order as today). Every machine's
 * scope stays mounted (warm socket + tabs); inactive ones are hidden. Only the
 * active scope should render `children` (the shared router/workspace), so the
 * expo-router Stack is not duplicated per machine.
 */
export default function MachineScope({
  target,
  isActive,
  autoConnect = true,
  children,
}: {
  target: ConnectTarget;
  isActive: boolean;
  autoConnect?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.scope, !isActive && styles.hiddenScope]} pointerEvents={isActive ? 'auto' : 'none'}>
      <ConnectionProvider>
        <ReviewPromptProvider>
          <PluginProvider>
            <SessionRegistryProvider>
              {autoConnect ? <MachineAutoConnect target={target} /> : null}
              {children}
            </SessionRegistryProvider>
          </PluginProvider>
        </ReviewPromptProvider>
      </ConnectionProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  scope: { flex: 1 },
  // Inactive scopes stay mounted but hidden. Use absolute + opacity, NOT
  // display:none — display:none makes Reanimated set ref.current=undefined on
  // frozen objects (same reason documented in PluginRenderer.tsx).
  hiddenScope: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0 },
});
