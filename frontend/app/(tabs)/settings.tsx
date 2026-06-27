import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import { usePlayer } from '@/src/state/PlayerContext';
import { useEQ } from '@/src/state/EQContext';
import SleepTimerSheet from '@/src/components/SleepTimerSheet';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const eq = useEQ();
  const router = useRouter();
  const [sleepOpen, setSleepOpen] = useState(false);

  const sleepLabel = player.sleepRemainingSec != null
    ? `${Math.floor(player.sleepRemainingSec / 60)}:${String(player.sleepRemainingSec % 60).padStart(2, '0')} remaining`
    : 'Off';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>App preferences & device permissions</Text>

        <Text style={styles.section}>Playback</Text>

        <Pressable onPress={() => setSleepOpen(true)} style={styles.row} testID="setting-sleep">
          <View style={styles.iconBox}><Ionicons name="moon" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Sleep timer</Text>
            <Text style={styles.rowMeta}>{sleepLabel}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.onSurfaceTertiary} />
        </Pressable>

        <View style={styles.row} testID="setting-gapless">
          <View style={styles.iconBox}><Ionicons name="link" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Gapless playback</Text>
            <Text style={styles.rowMeta}>Preloads next track for seamless transitions</Text>
          </View>
          <Switch
            value={player.gaplessEnabled} onValueChange={player.setGapless}
            trackColor={{ false: COLORS.surfaceTertiary, true: COLORS.brand }} thumbColor={COLORS.surface}
          />
        </View>

        <View style={styles.row} testID="setting-shuffle">
          <View style={styles.iconBox}><Ionicons name="shuffle" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Shuffle</Text>
            <Text style={styles.rowMeta}>Play tracks in random order</Text>
          </View>
          <Switch
            value={player.shuffle} onValueChange={player.toggleShuffle}
            trackColor={{ false: COLORS.surfaceTertiary, true: COLORS.brand }} thumbColor={COLORS.surface}
          />
        </View>

        <Pressable onPress={player.cycleRepeat} style={styles.row} testID="setting-repeat">
          <View style={styles.iconBox}><Ionicons name="repeat" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Repeat</Text>
            <Text style={styles.rowMeta}>{player.repeat === 'off' ? 'Off' : player.repeat === 'one' ? 'Repeat one' : 'Repeat all'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.onSurfaceTertiary} />
        </Pressable>

        <View style={styles.row}>
          <View style={styles.iconBox}><Ionicons name="options" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Equalizer</Text>
            <Text style={styles.rowMeta}>{eq.enabled ? `Active · ${eq.bands.length} bands` : 'Disabled'}</Text>
          </View>
          <Switch
            value={eq.enabled} onValueChange={eq.setEnabled}
            trackColor={{ false: COLORS.surfaceTertiary, true: COLORS.brand }} thumbColor={COLORS.surface}
          />
        </View>

        <Text style={styles.section}>Discover</Text>
        <Pressable onPress={() => router.push('/discover')} style={styles.row} testID="setting-discover">
          <View style={styles.iconBox}><Ionicons name="compass" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Community EQ profiles</Text>
            <Text style={styles.rowMeta}>Browse, star and share audiophile presets</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.onSurfaceTertiary} />
        </Pressable>

        <Text style={styles.section}>Library</Text>
        <Pressable onPress={() => player.loadFolders()} style={styles.row} testID="setting-rescan">
          <View style={styles.iconBox}><Ionicons name="refresh" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Rescan device</Text>
            <Text style={styles.rowMeta}>{player.folders.length} folders · {player.permissionGranted ? 'Granted' : 'Permission needed'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.onSurfaceTertiary} />
        </Pressable>

        <Pressable onPress={() => Linking.openSettings()} style={styles.row} testID="setting-permissions">
          <View style={styles.iconBox}><Ionicons name="lock-closed" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>System permissions</Text>
            <Text style={styles.rowMeta}>Open Android settings</Text>
          </View>
          <Ionicons name="open-outline" size={18} color={COLORS.onSurfaceTertiary} />
        </Pressable>

        <Text style={styles.section}>About</Text>
        <View style={styles.row}>
          <View style={styles.iconBox}><Ionicons name="information-circle" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>ChromeAmp</Text>
            <Text style={styles.rowMeta}>v1.1.0 · iPod-inspired audiophile player</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          Background playback, lock-screen / notification controls and real-time parametric EQ DSP activate after generating the Android APK via Emergent Publish (requires Android foreground service which is unavailable in Expo Go).
        </Text>
      </ScrollView>

      <SleepTimerSheet visible={sleepOpen} onClose={() => setSleepOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  title: { color: COLORS.onSurface, fontSize: 30, fontWeight: '800', paddingHorizontal: SPACING.lg, letterSpacing: -0.5 },
  subtitle: { color: COLORS.onSurfaceSecondary, fontSize: 13, paddingHorizontal: SPACING.lg, marginTop: 4, marginBottom: SPACING.lg },
  section: { color: COLORS.onSurfaceSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginTop: SPACING.xl, marginBottom: SPACING.sm, paddingHorizontal: SPACING.lg },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: 12, gap: 12, borderBottomColor: 'rgba(255,255,255,0.04)', borderBottomWidth: 0.5 },
  iconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: COLORS.onSurface, fontSize: 14, fontWeight: '600' },
  rowMeta: { color: COLORS.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  footer: { color: COLORS.onSurfaceTertiary, fontSize: 11, paddingHorizontal: SPACING.lg, marginTop: SPACING.xl, lineHeight: 16, textAlign: 'center' },
});
