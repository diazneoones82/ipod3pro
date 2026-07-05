import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, Linking, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import { usePlayer } from '@/src/state/PlayerContext';
import { useEQ } from '@/src/state/EQContext';
import SleepTimerSheet from '@/src/components/SleepTimerSheet';
import CustomSlider from '@/src/components/CustomSlider';
import { exportDiscoveredEqPresets, type EqPresetExportProgress } from '@/src/utils/export-eq-presets';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const eq = useEQ();
  const router = useRouter();
  const [sleepOpen, setSleepOpen] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [exportingEq, setExportingEq] = useState(false);
  const [exportProgress, setExportProgress] = useState<EqPresetExportProgress | null>(null);

  const sleepLabel = player.sleepRemainingSec != null
    ? `${Math.floor(player.sleepRemainingSec / 60)}:${String(player.sleepRemainingSec % 60).padStart(2, '0')} remaining`
    : 'Off';

  const handleRescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    try {
      const result = await player.loadFolders();
      Alert.alert('Scan completed', `Found ${result.folderCount} folders and ${result.trackCount} songs.`);
    } catch {
      Alert.alert('Scan completed', 'Device scan finished.');
    } finally {
      setRescanning(false);
    }
  };

  const handleExportEqPresets = async () => {
    if (exportingEq) return;
    setExportingEq(true);
    setExportProgress({ phase: 'selecting', current: 0, total: 0, message: 'Choose export folder' });
    try {
      const result = await exportDiscoveredEqPresets(setExportProgress);
      if (!result) {
        setExportProgress(null);
        return;
      }
      Alert.alert(
        'EQ presets saved',
        `Saved ${result.peqSaved} PEQ-AutoEQ and ${result.autoEqSaved} AutoEq presets.${result.failed ? ` ${result.failed} failed.` : ''}`,
      );
    } catch (e) {
      Alert.alert('EQ preset export failed', e instanceof Error ? e.message : 'Could not save presets.');
    } finally {
      setExportingEq(false);
      setExportProgress(null);
    }
  };

  const handleBatteryOptimization = async () => {
    try {
      if (Platform.OS === 'android' && typeof (Linking as any).sendIntent === 'function') {
        await (Linking as any).sendIntent('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', [
          { key: 'android.provider.extra.PACKAGE_NAME', value: 'com.shuffleimusic.player' },
        ]);
        return;
      }
      await Linking.openSettings();
    } catch {
      try {
        if (Platform.OS === 'android' && typeof (Linking as any).sendIntent === 'function') {
          await (Linking as any).sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
          return;
        }
      } catch {}
      Alert.alert('Battery optimization', 'Open Android battery settings and allow unrestricted battery usage for Shuffle MuSic.');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>App preferences & device permissions</Text>

        <Text style={styles.section}>Playback</Text>

        <View style={styles.sliderRow} testID="setting-wheel-haptics">
          <View style={styles.iconBox}><Ionicons name="radio-button-on" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Wheel haptic vibration</Text>
            <Text style={styles.rowMeta}>Set wheel feedback from lowest to highest</Text>
            <View style={styles.sliderWrap}>
              <CustomSlider
                testID="wheel-haptic-slider"
                min={0}
                max={100}
                step={1}
                value={player.wheelHapticStrength}
                formatValue={(v) => `${Math.round(v)}%`}
                onChange={player.setWheelHapticStrength}
              />
            </View>
          </View>
        </View>

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

        <View style={styles.visualizerRow} testID="setting-visualizer">
          <View style={styles.iconBox}><Ionicons name="pulse" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <View style={styles.rowTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Visualizer</Text>
                <Text style={styles.rowMeta}>Show motion above the wheel</Text>
              </View>
              <Switch
                value={player.visualizerEnabled}
                onValueChange={player.setVisualizerEnabled}
                trackColor={{ false: COLORS.surfaceTertiary, true: COLORS.brand }}
                thumbColor={COLORS.surface}
              />
            </View>
            <View style={styles.segmentRow}>
              <Pressable
                testID="visualizer-mode-sea"
                onPress={() => player.setVisualizerMode('sea')}
                style={[styles.segmentBtn, player.visualizerMode === 'sea' && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, player.visualizerMode === 'sea' && styles.segmentTextActive]}>Sea wave</Text>
              </Pressable>
              <Pressable
                testID="visualizer-mode-bars"
                onPress={() => player.setVisualizerMode('bars')}
                style={[styles.segmentBtn, player.visualizerMode === 'bars' && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, player.visualizerMode === 'bars' && styles.segmentTextActive]}>Color bands</Text>
              </Pressable>
            </View>
          </View>
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

        <Pressable onPress={handleExportEqPresets} style={styles.row} testID="setting-export-eq-presets">
          <View style={styles.iconBox}><Ionicons name="download" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Save PEQ / AutoEq presets</Text>
            <Text style={styles.rowMeta}>
              {exportProgress
                ? `${exportProgress.message}${exportProgress.total ? ` · ${exportProgress.current}/${exportProgress.total}` : ''}`
                : 'Choose an Android folder and download all discovered presets'}
            </Text>
          </View>
          <Ionicons name={exportingEq ? 'hourglass-outline' : 'folder-open-outline'} size={18} color={COLORS.onSurfaceTertiary} />
        </Pressable>

        <Text style={styles.section}>Library</Text>
        <Pressable onPress={handleRescan} style={styles.row} testID="setting-rescan">
          <View style={styles.iconBox}><Ionicons name="refresh" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Rescan device</Text>
            <Text style={styles.rowMeta}>
              {rescanning ? 'Scanning music folders...' : `${player.folders.length} folders · ${player.permissionGranted ? 'Granted' : 'Permission needed'}`}
            </Text>
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

        <Pressable onPress={handleBatteryOptimization} style={styles.row} testID="setting-battery-optimization">
          <View style={styles.iconBox}><Ionicons name="battery-charging" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Ignore battery optimization</Text>
            <Text style={styles.rowMeta}>Allow background playback to continue across long folders</Text>
          </View>
          <Ionicons name="open-outline" size={18} color={COLORS.onSurfaceTertiary} />
        </Pressable>

        <Text style={styles.section}>About</Text>
        <View style={styles.row}>
          <View style={styles.iconBox}><Ionicons name="information-circle" size={18} color={COLORS.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Author</Text>
            <Text style={styles.rowMeta}>Bartholomew Diaz Michael</Text>
            <Text style={styles.rowMeta}>Shuffle MuSic is an iPod-inspired offline music player with PEQ discovery, lyrics, album art, Bluetooth sharing and tactile wheel controls.</Text>
          </View>
        </View>
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
  visualizerRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: SPACING.lg, paddingVertical: 12, gap: 12, borderBottomColor: 'rgba(255,255,255,0.04)', borderBottomWidth: 0.5 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  segmentRow: { flexDirection: 'row', gap: 8, marginTop: SPACING.sm },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: RADIUS.md, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'transparent' },
  segmentBtnActive: { backgroundColor: COLORS.brandTertiary, borderColor: COLORS.brand },
  segmentText: { color: COLORS.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  segmentTextActive: { color: COLORS.brand },
  sliderRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: SPACING.lg, paddingVertical: 12, gap: 12, borderBottomColor: 'rgba(255,255,255,0.04)', borderBottomWidth: 0.5 },
  sliderWrap: { marginTop: SPACING.sm },
  iconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: COLORS.onSurface, fontSize: 14, fontWeight: '600' },
  rowMeta: { color: COLORS.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
});
