import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Dimensions, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import GlassCard from '@/src/components/GlassCard';
import FrequencyGraph from '@/src/components/FrequencyGraph';
import CustomSlider from '@/src/components/CustomSlider';
import { useEQ } from '@/src/state/EQContext';
import { FILTER_TYPE_LABEL, type FilterType, PRESETS } from '@/src/utils/eq-parser';
import { useRouter } from 'expo-router';

const FILTER_TYPES: FilterType[] = ['PK', 'LSC', 'HSC', 'LP', 'HP', 'NO', 'BP', 'AP'];

export default function EqualizerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const eq = useEQ();
  const [toast, setToast] = useState<string | null>(null);
  const [filterPickerForId, setFilterPickerForId] = useState<string | null>(null);

  const screenWidth = Dimensions.get('window').width;
  const graphWidth = screenWidth - SPACING.lg * 2 - 32;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const handleImport = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['text/plain', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const uri = res.assets[0].uri;
      const text = await FileSystem.readAsStringAsync(uri);
      const ok = eq.importConfig(text);
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        showToast('EQ config imported');
      } else {
        showToast('Invalid config format');
      }
    } catch (e) {
      showToast('Import failed');
    }
  }, [eq]);

  const handleExport = useCallback(async () => {
    try {
      const text = eq.exportConfig();
      const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!dir) { showToast('Storage unavailable'); return; }
      const path = `${dir}chromeamp-eq.txt`;
      await FileSystem.writeAsStringAsync(path, text);
      try {
        const Sharing = await import('expo-sharing');
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: 'Share EQ config' });
          return;
        }
      } catch {}
      showToast(`Saved to ${path}`);
    } catch {
      showToast('Export failed');
    }
  }, [eq]);

  const openDiscover = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push('/discover');
  }, [router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Parametric EQ</Text>
            <Text style={styles.subtitle}>Equalizer APO compatible</Text>
          </View>
          <Pressable
            testID="open-discover-btn"
            onPress={openDiscover}
            style={styles.discoverBtn}
            hitSlop={8}
          >
            <Ionicons name="compass" size={14} color={COLORS.brand} />
            <Text style={styles.discoverBtnText}>Discover</Text>
          </Pressable>
          <View style={styles.enableRow}>
            <Text style={styles.enableLabel}>{eq.enabled ? 'ON' : 'OFF'}</Text>
            <Switch
              testID="eq-enable-switch"
              value={eq.enabled}
              onValueChange={eq.setEnabled}
              trackColor={{ false: COLORS.surfaceTertiary, true: COLORS.brand }}
              thumbColor={COLORS.surface}
            />
          </View>
        </View>

        {/* Graph */}
        <GlassCard style={{ marginHorizontal: SPACING.lg }} testID="eq-graph-card">
          <FrequencyGraph bands={eq.bands} preamp={eq.preamp} width={graphWidth} height={140} />
          <View style={{ marginTop: SPACING.md }}>
            <CustomSlider
              testID="preamp-slider"
              min={-12} max={12} value={eq.preamp}
              label="Preamp"
              formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`}
              onChange={(v) => eq.setPreamp(v)}
            />
          </View>
        </GlassCard>

        {/* Presets */}
        <Text style={styles.sectionLabel}>Presets</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetsRow}>
          {PRESETS.map((p) => {
            const selected = eq.selectedPreset === p.name;
            return (
              <Pressable
                key={p.name}
                testID={`preset-${p.name}`}
                onPress={() => { eq.applyPreset(p.name); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }}
                style={[styles.presetChip, selected && styles.presetChipSelected]}
              >
                <Text style={[styles.presetText, selected && styles.presetTextSelected]}>{p.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Bands */}
        <View style={styles.bandsHeader}>
          <Text style={styles.sectionLabel}>Bands ({eq.bands.length})</Text>
          <Pressable testID="add-band-btn" onPress={eq.addBand} style={styles.addBtn}>
            <Ionicons name="add" size={16} color={COLORS.brand} />
            <Text style={styles.addBtnText}>Add band</Text>
          </Pressable>
        </View>

        {eq.bands.map((band, i) => (
          <GlassCard key={band.id} style={{ marginHorizontal: SPACING.lg, marginBottom: SPACING.md }} testID={`band-${i}`}>
            <View style={styles.bandHeader}>
              <Text style={styles.bandIdx}>{i + 1}</Text>
              <Pressable
                testID={`band-type-${i}`}
                onPress={() => setFilterPickerForId(filterPickerForId === band.id ? null : band.id)}
                style={styles.typeChip}
              >
                <Text style={styles.typeChipText}>{FILTER_TYPE_LABEL[band.type]}</Text>
                <Ionicons name="chevron-down" size={12} color={COLORS.onSurfaceSecondary} />
              </Pressable>
              <View style={{ flex: 1 }} />
              <Switch
                testID={`band-enabled-${i}`}
                value={band.enabled}
                onValueChange={(v) => eq.updateBand(band.id, { enabled: v })}
                trackColor={{ false: COLORS.surfaceTertiary, true: COLORS.brand }}
                thumbColor={COLORS.surface}
              />
              <Pressable testID={`band-remove-${i}`} onPress={() => eq.removeBand(band.id)} hitSlop={10} style={styles.removeBtn}>
                <Ionicons name="trash-outline" size={16} color={COLORS.error} />
              </Pressable>
            </View>

            {filterPickerForId === band.id && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 6 }}>
                {FILTER_TYPES.map((t) => (
                  <Pressable
                    key={t}
                    testID={`band-type-opt-${i}-${t}`}
                    onPress={() => { eq.updateBand(band.id, { type: t }); setFilterPickerForId(null); }}
                    style={[styles.typeOption, band.type === t && styles.typeOptionSelected]}
                  >
                    <Text style={[styles.typeOptionText, band.type === t && styles.typeOptionTextSelected]}>{FILTER_TYPE_LABEL[t]}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            <View style={{ marginTop: SPACING.md, gap: SPACING.md }}>
              <CustomSlider
                testID={`band-freq-${i}`}
                min={20} max={20000} value={band.freq} logScale
                label="Frequency"
                formatValue={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${v.toFixed(0)} Hz`}
                onChange={(v) => eq.updateBand(band.id, { freq: v })}
              />
              <CustomSlider
                testID={`band-gain-${i}`}
                min={-18} max={18} value={band.gain}
                label="Gain"
                formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`}
                onChange={(v) => eq.updateBand(band.id, { gain: v })}
              />
              <CustomSlider
                testID={`band-q-${i}`}
                min={0.1} max={10} value={band.q}
                label="Q Factor"
                formatValue={(v) => v.toFixed(2)}
                onChange={(v) => eq.updateBand(band.id, { q: v })}
              />
            </View>
          </GlassCard>
        ))}

        {/* Action buttons */}
        <View style={styles.actionsRow}>
          <Pressable testID="import-eq-btn" onPress={handleImport} style={[styles.actionBtn, styles.actionPrimary]}>
            <Ionicons name="download-outline" size={16} color={COLORS.onBrandPrimary} />
            <Text style={styles.actionPrimaryText}>Import .txt</Text>
          </Pressable>
          <Pressable testID="export-eq-btn" onPress={handleExport} style={[styles.actionBtn, styles.actionSecondary]}>
            <Ionicons name="share-outline" size={16} color={COLORS.onSurface} />
            <Text style={styles.actionSecondaryText}>Export</Text>
          </Pressable>
          <Pressable testID="reset-eq-btn" onPress={eq.resetAll} style={[styles.actionBtn, styles.actionSecondary]}>
            <Ionicons name="refresh-outline" size={16} color={COLORS.onSurface} />
            <Text style={styles.actionSecondaryText}>Reset</Text>
          </Pressable>
        </View>

        <Text style={styles.disclaimer}>
          UI EQ curve is visualized in real-time. Real-time DSP filtering activates in native APK build (uses Android AudioEffect / Equalizer system services).
        </Text>
      </ScrollView>

      {toast && (
        <View style={[styles.toast, { bottom: insets.bottom + 90 }]} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  title: { color: COLORS.onSurface, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: COLORS.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  enableRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discoverBtn: { flexDirection: 'row', gap: 5, alignItems: 'center', backgroundColor: COLORS.brandTertiary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, marginRight: 8 },
  discoverBtnText: { color: COLORS.brand, fontSize: 12, fontWeight: '700' },
  enableLabel: { color: COLORS.onSurfaceSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  sectionLabel: { color: COLORS.onSurfaceSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginTop: SPACING.xl, marginBottom: SPACING.sm, paddingHorizontal: SPACING.lg },
  presetsRow: { paddingHorizontal: SPACING.lg, gap: 8, paddingBottom: 4 },
  presetChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'transparent', flexShrink: 0 },
  presetChipSelected: { backgroundColor: COLORS.brandTertiary, borderColor: COLORS.brand },
  presetText: { color: COLORS.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  presetTextSelected: { color: COLORS.brand },
  bandsHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: SPACING.lg },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.brandTertiary, marginBottom: SPACING.sm },
  addBtnText: { color: COLORS.brand, fontSize: 12, fontWeight: '700' },
  bandHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bandIdx: { color: COLORS.brand, fontSize: 13, fontWeight: '700', width: 18 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.sm },
  typeChipText: { color: COLORS.onSurface, fontSize: 12, fontWeight: '600' },
  removeBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  typeOption: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.sm, backgroundColor: 'rgba(255,255,255,0.04)' },
  typeOptionSelected: { backgroundColor: COLORS.brandTertiary },
  typeOptionText: { color: COLORS.onSurfaceSecondary, fontSize: 11, fontWeight: '600' },
  typeOptionTextSelected: { color: COLORS.brand },
  actionsRow: { flexDirection: 'row', paddingHorizontal: SPACING.lg, gap: 8, marginTop: SPACING.lg },
  actionBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: RADIUS.md },
  actionPrimary: { backgroundColor: COLORS.brand },
  actionPrimaryText: { color: COLORS.onBrandPrimary, fontWeight: '700', fontSize: 13 },
  actionSecondary: { backgroundColor: 'rgba(255,255,255,0.06)' },
  actionSecondaryText: { color: COLORS.onSurface, fontWeight: '600', fontSize: 13 },
  disclaimer: { color: COLORS.onSurfaceTertiary, fontSize: 11, paddingHorizontal: SPACING.lg, marginTop: SPACING.lg, lineHeight: 16 },
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(245,158,11,0.95)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill },
  toastText: { color: COLORS.onBrandPrimary, fontSize: 13, fontWeight: '700' },
});
