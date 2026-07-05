import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Dimensions, Switch, Modal, TextInput } from 'react-native';
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
  const [saveProfileOpen, setSaveProfileOpen] = useState(false);
  const [saveProfileSlot, setSaveProfileSlot] = useState(1);
  const [saveProfileName, setSaveProfileName] = useState('');

  const screenWidth = Dimensions.get('window').width;
  const graphWidth = screenWidth - SPACING.lg * 2 - 32;
  const dspStatusText = eq.dspStatus.status === 'active'
    ? (eq.dspStatus.processedBuffers ?? 0) > 0
      ? `DSP processing - ${eq.dspStatus.lastActiveBandCount ?? eq.dspStatus.bandCount} bands @ ${eq.dspStatus.lastSampleRate ?? 0} Hz`
      : `DSP armed - ${eq.dspStatus.bandCount} bands`
    : eq.dspStatus.status === 'bypassed'
      ? 'DSP bypassed'
      : eq.dspStatus.message;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const handleImport = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['text/plain', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const uri = asset.uri;
      const text = await FileSystem.readAsStringAsync(uri);
      const ok = eq.importConfig(text, asset.name?.replace(/\.[^.]+$/, '') || 'Imported EQ');
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

  const openSaveProfile = useCallback((slot: number) => {
    const current = eq.customProfiles.find((p) => p.slot === slot);
    setSaveProfileSlot(slot);
    setSaveProfileName(current?.name || `Custom ${slot}`);
    setSaveProfileOpen(true);
  }, [eq.customProfiles]);

  const saveCustomProfile = useCallback(() => {
    eq.saveCustomProfile(saveProfileSlot, saveProfileName);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSaveProfileOpen(false);
    showToast(`Saved profile ${saveProfileSlot}`);
  }, [eq, saveProfileName, saveProfileSlot]);

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

        <View style={styles.dspStatusRow} testID="native-dsp-status">
          <View style={[
            styles.dspDot,
            eq.dspStatus.status === 'active' && styles.dspDotActive,
            eq.dspStatus.status === 'bypassed' && styles.dspDotBypassed,
            eq.dspStatus.status === 'unavailable' && styles.dspDotError,
          ]} />
          <Text style={styles.dspStatusText} numberOfLines={2}>
            {dspStatusText}
          </Text>
        </View>

        {/* Graph */}
        <GlassCard style={{ marginHorizontal: SPACING.lg }} testID="eq-graph-card">
          <View style={styles.loadedProfileRow} testID="loaded-peq-name">
            <Ionicons name="checkmark-circle" size={13} color={COLORS.success} />
            <Text style={styles.loadedProfileText} numberOfLines={1} ellipsizeMode="tail">
              {eq.selectedPreset ? `Loaded: ${eq.selectedPreset}` : 'Loaded: Manual EQ'}
            </Text>
          </View>
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
        <Text style={styles.sectionLabel}>Presets & Profiles</Text>
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

        {/* Audio Effects Section */}
        <Text style={styles.sectionLabel}>Enhancements</Text>
        <GlassCard style={{ marginHorizontal: SPACING.lg, gap: SPACING.md }} testID="audio-enhancements-card">
          <CustomSlider
            testID="bass-boost-slider"
            min={0} max={12} value={eq.bassBoostDb}
            label="Bass Boost"
            formatValue={(v) => `${v.toFixed(1)} dB`}
            onChange={(v) => eq.setBassBoost(v)}
          />
          <CustomSlider
            testID="loudness-slider"
            min={0} max={12} value={eq.loudnessDb}
            label="Loudness Enhancer"
            formatValue={(v) => `+${v.toFixed(1)} dB`}
            onChange={(v) => eq.setLoudness(v)}
          />
          <CustomSlider
            testID="stereo-width-slider"
            min={0} max={2.0} value={eq.stereoWidth}
            label="Stereo Width"
            formatValue={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => eq.setStereoWidth(v)}
          />
          <CustomSlider
            testID="virtualizer-slider"
            min={0} max={100} value={eq.virtualizerStrength}
            label="Virtualizer / Surround"
            formatValue={(v) => `${v.toFixed(0)}%`}
            onChange={(v) => eq.setVirtualizer(v)}
          />
        </GlassCard>

        <Text style={styles.sectionLabel}>Custom Profiles</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.customProfileRow}>
          {[1, 2, 3, 4, 5].map((slot) => {
            const profile = eq.customProfiles.find((p) => p.slot === slot);
            return (
              <View key={slot} style={styles.customProfileCard}>
                <Text style={styles.customSlot}>Slot {slot}</Text>
                <Text style={styles.customProfileName} numberOfLines={1}>{profile?.name || 'Empty'}</Text>
                <View style={styles.customProfileActions}>
                  <Pressable
                    testID={`custom-eq-apply-${slot}`}
                    disabled={!profile}
                    onPress={() => {
                      if (eq.applyCustomProfile(slot)) {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                        showToast(`Loaded ${profile?.name || `profile ${slot}`}`);
                      }
                    }}
                    style={[styles.customIconBtn, !profile && styles.customIconBtnDisabled]}
                  >
                    <Ionicons name="play" size={13} color={profile ? COLORS.onBrandPrimary : COLORS.onSurfaceTertiary} />
                  </Pressable>
                  <Pressable testID={`custom-eq-save-${slot}`} onPress={() => openSaveProfile(slot)} style={styles.customIconBtnSecondary}>
                    <Ionicons name="save-outline" size={14} color={COLORS.brand} />
                  </Pressable>
                  <Pressable
                    testID={`custom-eq-delete-${slot}`}
                    disabled={!profile}
                    onPress={() => {
                      eq.deleteCustomProfile(slot);
                      showToast(`Cleared slot ${slot}`);
                    }}
                    style={[styles.customIconBtnSecondary, !profile && styles.customIconBtnDisabled]}
                  >
                    <Ionicons name="trash-outline" size={14} color={profile ? COLORS.error : COLORS.onSurfaceTertiary} />
                  </Pressable>
                </View>
              </View>
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
            <Text style={styles.actionPrimaryText}>Import</Text>
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
          Native PEQ DSP uses the APK audio engine and updates while music plays.
        </Text>
        {false && (
        <View style={styles.dspStatusRow} testID="native-dsp-status">
          <View style={[
            styles.dspDot,
            eq.dspStatus.status === 'active' && styles.dspDotActive,
            eq.dspStatus.status === 'bypassed' && styles.dspDotBypassed,
            eq.dspStatus.status === 'unavailable' && styles.dspDotError,
          ]} />
          <Text style={styles.dspStatusText} numberOfLines={2}>
            {eq.dspStatus.status === 'active'
              ? `DSP active · ${eq.dspStatus.bandCount} bands`
              : eq.dspStatus.status === 'bypassed'
                ? 'DSP bypassed'
                : eq.dspStatus.message}
          </Text>
        </View>
        )}
      </ScrollView>

      {toast && (
        <View style={[styles.toast, { bottom: insets.bottom + 90 }]} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      <Modal visible={saveProfileOpen} transparent animationType="fade" onRequestClose={() => setSaveProfileOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.saveDialog}>
            <Text style={styles.saveDialogTitle}>Save EQ Profile</Text>
            <Text style={styles.saveDialogMeta}>Slot {saveProfileSlot}</Text>
            <TextInput
              testID="custom-eq-name-input"
              value={saveProfileName}
              onChangeText={setSaveProfileName}
              placeholder="Profile name"
              placeholderTextColor={COLORS.onSurfaceTertiary}
              style={styles.saveInput}
              maxLength={32}
            />
            <View style={styles.dialogActions}>
              <Pressable onPress={() => setSaveProfileOpen(false)} style={[styles.dialogBtn, styles.actionSecondary]}>
                <Text style={styles.actionSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable testID="custom-eq-confirm-save" onPress={saveCustomProfile} style={[styles.dialogBtn, styles.actionPrimary]}>
                <Text style={styles.actionPrimaryText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  customProfileRow: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingBottom: 4 },
  customProfileCard: { width: 136, padding: 10, borderRadius: RADIUS.md, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  customSlot: { color: COLORS.onSurfaceTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  customProfileName: { color: COLORS.onSurface, fontSize: 13, fontWeight: '700', marginTop: 4 },
  customProfileActions: { flexDirection: 'row', gap: 6, marginTop: 10 },
  customIconBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.brand, alignItems: 'center', justifyContent: 'center' },
  customIconBtnSecondary: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  customIconBtnDisabled: { opacity: 0.38 },
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
  dspStatusRow: { marginHorizontal: SPACING.lg, marginTop: SPACING.sm, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: 'rgba(255,255,255,0.05)' },
  dspDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.onSurfaceTertiary },
  dspDotActive: { backgroundColor: COLORS.success },
  dspDotBypassed: { backgroundColor: COLORS.brand },
  dspDotError: { backgroundColor: COLORS.error },
  dspStatusText: { flex: 1, color: COLORS.onSurfaceSecondary, fontSize: 11, fontWeight: '600' },
  loadedProfileRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACING.sm, minWidth: 0 },
  loadedProfileText: { flex: 1, color: COLORS.onSurface, fontSize: 12, fontWeight: '700' },
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(245,158,11,0.95)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill },
  toastText: { color: COLORS.onBrandPrimary, fontSize: 13, fontWeight: '700' },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)', padding: SPACING.lg },
  saveDialog: { width: '100%', maxWidth: 360, borderRadius: RADIUS.lg, backgroundColor: COLORS.surfaceSecondary, padding: SPACING.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  saveDialogTitle: { color: COLORS.onSurface, fontSize: 18, fontWeight: '800' },
  saveDialogMeta: { color: COLORS.onSurfaceTertiary, fontSize: 12, marginTop: 2, marginBottom: SPACING.md },
  saveInput: { color: COLORS.onSurface, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  dialogActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  dialogBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, paddingVertical: 11 },
});
