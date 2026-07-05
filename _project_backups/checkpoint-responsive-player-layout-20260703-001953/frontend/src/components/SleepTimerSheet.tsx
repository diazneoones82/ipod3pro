import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { COLORS, RADIUS, SPACING } from '@/src/theme/tokens';
import { usePlayer } from '@/src/state/PlayerContext';

const PRESETS = [
  { label: '5 min', minutes: 5 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '1 hour', minutes: 60 },
  { label: '90 min', minutes: 90 },
];

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function SleepTimerSheet({ visible, onClose }: Props) {
  const player = usePlayer();

  const setMinutes = (m: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    player.setSleepTimer(m);
    onClose();
  };

  const clear = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    player.setSleepTimer(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="sleep-backdrop">
        <Pressable style={styles.sheetWrap} onPress={(e) => e.stopPropagation()}>
          <BlurView intensity={Platform.OS === 'ios' ? 70 : 100} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.tint} />
          <View style={styles.handle} />

          <View style={styles.header}>
            <Ionicons name="moon" size={20} color={COLORS.brand} />
            <Text style={styles.title}>Sleep Timer</Text>
            {player.sleepTimerEnd != null && (
              <Pressable testID="sleep-clear-btn" onPress={clear} style={styles.clearChip}>
                <Text style={styles.clearText}>Clear</Text>
              </Pressable>
            )}
          </View>

          <Text style={styles.subtitle}>
            {player.sleepRemainingSec != null
              ? `Pausing in ${fmt(player.sleepRemainingSec)}`
              : 'Music pauses after the chosen duration'}
          </Text>

          <View style={styles.grid}>
            {PRESETS.map((p) => (
              <Pressable
                key={p.label}
                testID={`sleep-${p.minutes}`}
                onPress={() => setMinutes(p.minutes)}
                style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.chipText}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheetWrap: {
    overflow: 'hidden',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING['2xl'],
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(18,18,26,0.85)',
  },
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,5,10,0.6)' },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'center', marginBottom: SPACING.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: COLORS.onSurface, fontSize: 18, fontWeight: '700', flex: 1 },
  subtitle: { color: COLORS.onSurfaceSecondary, fontSize: 13, marginTop: 4, marginBottom: SPACING.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)',
    minWidth: 90, alignItems: 'center',
  },
  chipText: { color: COLORS.onSurface, fontWeight: '700', fontSize: 13 },
  clearChip: { backgroundColor: COLORS.error, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill },
  clearText: { color: COLORS.onSurface, fontSize: 11, fontWeight: '700' },
});
