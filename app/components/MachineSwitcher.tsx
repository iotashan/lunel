import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Monitor, Plus, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useMachineRegistry } from '@/contexts/MachineRegistry';

/**
 * Machine switcher: lists paired machines, highlights the active one, switches
 * instantly (pure setActive — sockets stay warm), and routes to lunel-connect to
 * add another. Intended to mount in DrawerContent. Renders nothing for <=1
 * machine so the single-machine UI is unchanged.
 */
export default function MachineSwitcher({ onSwitch }: { onSwitch?: () => void }) {
  const { colors, fonts } = useTheme();
  const { machines, activeMachineId, setActive, removeMachine } = useMachineRegistry();
  const router = useRouter();

  if (machines.length <= 1) return null;

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.fg.muted, fontFamily: fonts.sans.medium }]}>Machines</Text>
      {machines.map((m) => {
        const isActive = m.id === activeMachineId;
        return (
          <View
            key={m.id}
            style={[styles.row, { backgroundColor: isActive ? colors.bg.raised : 'transparent' }]}
          >
            <TouchableOpacity
              style={styles.rowMain}
              activeOpacity={0.7}
              onPress={() => {
                setActive(m.id);
                onSwitch?.();
              }}
            >
              <Monitor size={16} color={isActive ? colors.accent.default : colors.fg.muted} strokeWidth={2} />
              <Text
                numberOfLines={1}
                style={[styles.rowLabel, { color: colors.fg.default, fontFamily: fonts.sans.regular, opacity: isActive ? 1 : 0.8 }]}
              >
                {m.label}
              </Text>
              {isActive ? <View style={[styles.activeDot, { backgroundColor: '#22c55e' }]} /> : null}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.removeBtn}
              activeOpacity={0.7}
              onPress={() => removeMachine(m.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={15} color={colors.fg.subtle} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        );
      })}
      <TouchableOpacity
        style={styles.addRow}
        activeOpacity={0.7}
        onPress={() => {
          router.push('/lunel-connect?add=1' as any);
          onSwitch?.();
        }}
      >
        <Plus size={16} color={colors.fg.muted} strokeWidth={2} />
        <Text style={[styles.addLabel, { color: colors.fg.muted, fontFamily: fonts.sans.regular }]}>Add machine</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 14, paddingVertical: 8, gap: 2 },
  label: { fontSize: 12, marginBottom: 6, opacity: 0.65 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 8 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 10 },
  rowLabel: { flex: 1, fontSize: 14 },
  activeDot: { width: 7, height: 7, borderRadius: 4 },
  removeBtn: { paddingHorizontal: 10, paddingVertical: 9 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 10, marginTop: 2 },
  addLabel: { fontSize: 14 },
});
