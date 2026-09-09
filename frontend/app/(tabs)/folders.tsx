import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, FlatList, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import GlassCard from '@/src/components/GlassCard';
import { usePlayer, type FolderInfo } from '@/src/state/PlayerContext';
import { pullAlbumArtForFolder } from '@/src/utils/album-art';

export default function FoldersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const player = usePlayer();
  const [loading, setLoading] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [artRefreshingPath, setArtRefreshingPath] = useState<string | null>(null);

  const recent = useMemo(() =>
    player.recentFolders
      .map((p) => player.folders.find((f) => f.path === p))
      .filter(Boolean) as FolderInfo[]
  , [player.recentFolders, player.folders]);

  const quickFolders = useMemo(() =>
    player.quickFolderPaths
      .map((p) => player.folders.find((f) => f.path === p))
      .filter(Boolean) as FolderInfo[]
  , [player.quickFolderPaths, player.folders]);

  const openFolder = (f: FolderInfo) => {
    router.push({ pathname: '/folder/[path]', params: { path: encodeURIComponent(f.path) } });
  };

  const playAll = (f: FolderInfo) => {
    player.playFolder(f.path, 0);
    router.push('/(tabs)');
  };

  const openAddFolder = async () => {
    if (player.folders.length === 0) {
      Alert.alert('Library', 'Run Rescan device from Settings to refresh folders.');
      return;
    }
    setFolderPickerOpen(true);
  };

  const refreshQuickFolderArt = async (f: FolderInfo) => {
    if (artRefreshingPath) return;
    setArtRefreshingPath(f.path);
    try {
      const { updated, checked } = await pullAlbumArtForFolder(f, player.artworkOverrides, player.setTrackArtwork);
      Alert.alert('Album art completed', `Updated ${updated} of ${checked} songs in ${f.name}.`);
    } catch {
      Alert.alert('Album art unavailable', 'Album art could not be refreshed right now.');
    } finally {
      setArtRefreshingPath(null);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <LinearGradient colors={['rgba(245,158,11,0.08)', 'transparent']} style={[StyleSheet.absoluteFill, { height: 240 }]} />
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Storage</Text>
          <Text style={styles.subtitle}>Pick a folder to play all songs inside</Text>
        </View>
        <Pressable testID="add-quick-folder-btn" onPress={openAddFolder} style={styles.addFolderBtn}>
          <Ionicons name="add" size={18} color={COLORS.brand} />
          <Ionicons name="settings-outline" size={15} color={COLORS.brand} />
        </Pressable>
      </View>

      {!player.permissionGranted && !loading && (
        <GlassCard style={{ marginTop: SPACING.lg, marginHorizontal: SPACING.lg }}>
          <Text style={styles.permTitle}>Permission required</Text>
          <Text style={styles.permBody}>Shuffle MuSic needs access to read audio files on your device.</Text>
          <Pressable
            testID="grant-permission-btn"
            onPress={async () => {
              setLoading(true);
              await player.loadFolders();
              setLoading(false);
            }}
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.primaryBtnText}>Grant Access</Text>
          </Pressable>
        </GlassCard>
      )}

      {loading && (
        <View style={{ paddingTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={COLORS.brand} />
          <Text style={[styles.subtitle, { marginTop: 12 }]}>Scanning audio files…</Text>
        </View>
      )}

      {!loading && player.permissionGranted && player.folders.length === 0 && (
        <View style={{ alignItems: 'center', paddingTop: 60 }}>
          <Ionicons name="folder-open-outline" size={48} color={COLORS.onSurfaceTertiary} />
          <Text style={[styles.subtitle, { marginTop: 12 }]}>No audio files found on device</Text>
        </View>
      )}

      {!loading && quickFolders.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Quick Folders</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
            {quickFolders.map((f) => (
              <View key={f.path} style={styles.recentCard}>
                <GlassCard>
                  <View style={styles.quickHeader}>
                    <Pressable testID={`quick-play-${f.path}`} onPress={() => playAll(f)} hitSlop={8}>
                      <Ionicons name="play-circle" size={28} color={COLORS.brand} />
                    </Pressable>
                    <View style={styles.quickActions}>
                      <Pressable
                        testID={`quick-art-refresh-${f.path}`}
                        disabled={artRefreshingPath === f.path}
                        onPress={() => refreshQuickFolderArt(f)}
                        hitSlop={8}
                        style={styles.quickActionBtn}
                      >
                        <Ionicons name={artRefreshingPath === f.path ? 'hourglass-outline' : 'refresh'} size={15} color={COLORS.brand} />
                        <Ionicons name="settings-outline" size={12} color={COLORS.brand} />
                      </Pressable>
                      <Pressable testID={`quick-remove-${f.path}`} onPress={() => player.removeQuickFolder(f.path)} hitSlop={8}>
                        <Ionicons name="close" size={18} color={COLORS.onSurfaceTertiary} />
                      </Pressable>
                    </View>
                  </View>
                  <Pressable testID={`quick-open-${f.path}`} onPress={() => openFolder(f)}>
                    <Text style={styles.recentName} numberOfLines={1}>{f.name}</Text>
                    <Text style={styles.recentMeta}>{f.trackCount} tracks</Text>
                  </Pressable>
                </GlassCard>
              </View>
            ))}
          </ScrollView>
        </>
      )}

      {!loading && recent.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Recently Played</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
            {recent.map((f) => (
              <Pressable key={f.path} testID={`recent-${f.path}`} onPress={() => playAll(f)} style={styles.recentCard}>
                <GlassCard>
                  <Ionicons name="play-circle" size={28} color={COLORS.brand} />
                  <Text style={styles.recentName} numberOfLines={1}>{f.name}</Text>
                  <Text style={styles.recentMeta}>{f.trackCount} tracks</Text>
                </GlassCard>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      {!loading && player.folders.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>All Folders</Text>
          <FlatList
            data={player.folders}
            keyExtractor={(f) => f.path}
            contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: SPACING.lg }}
            renderItem={({ item }) => (
              <Pressable testID={`folder-row-${item.path}`} onPress={() => openFolder(item)} style={styles.row}>
                <View style={styles.iconBox}>
                  <Ionicons name="folder" size={22} color={COLORS.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.rowMeta}>
                    {artRefreshingPath === item.path ? 'Refreshing album art...' : `${item.trackCount} tracks`}
                  </Text>
                </View>
                <Pressable
                  testID={`folder-art-refresh-${item.path}`}
                  disabled={artRefreshingPath === item.path}
                  onPress={() => refreshQuickFolderArt(item)}
                  hitSlop={12}
                  style={[styles.folderArtBtn, artRefreshingPath === item.path && { opacity: 0.55 }]}
                >
                  <Ionicons name={artRefreshingPath === item.path ? 'hourglass-outline' : 'refresh'} size={15} color={COLORS.brand} />
                  <Ionicons name="settings-outline" size={12} color={COLORS.brand} />
                </Pressable>
                <Pressable
                  testID={`folder-play-${item.path}`}
                  onPress={() => playAll(item)}
                  hitSlop={12}
                  style={styles.playPill}
                >
                  <Ionicons name="play" size={14} color={COLORS.onBrandPrimary} />
                </Pressable>
              </Pressable>
            )}
          />
        </>
      )}

      <Modal visible={folderPickerOpen} transparent animationType="slide" onRequestClose={() => setFolderPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.folderPicker}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Add Quick Folder</Text>
              <Pressable onPress={() => setFolderPickerOpen(false)} hitSlop={12} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={COLORS.onSurface} />
              </Pressable>
            </View>
            <FlatList
              data={player.folders}
              keyExtractor={(f) => f.path}
              contentContainerStyle={{ paddingBottom: SPACING.md }}
              renderItem={({ item }) => {
                const saved = player.quickFolderPaths.includes(item.path);
                return (
                  <Pressable
                    testID={`quick-folder-option-${item.path}`}
                    onPress={() => {
                      player.addQuickFolder(item.path);
                      setFolderPickerOpen(false);
                    }}
                    style={styles.pickerRow}
                  >
                    <Ionicons name={saved ? 'checkmark-circle' : 'folder-outline'} size={20} color={saved ? COLORS.success : COLORS.brand} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.rowMeta}>{item.trackCount} tracks</Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  titleRow: { flexDirection: 'row', alignItems: 'center', paddingRight: SPACING.lg },
  title: { color: COLORS.onSurface, fontSize: 30, fontWeight: '800', paddingHorizontal: SPACING.lg, letterSpacing: -0.5 },
  subtitle: { color: COLORS.onSurfaceSecondary, fontSize: 13, paddingHorizontal: SPACING.lg, marginTop: 4 },
  addFolderBtn: { width: 44, height: 36, borderRadius: 18, backgroundColor: COLORS.brandTertiary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 1 },
  permTitle: { color: COLORS.onSurface, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  permBody: { color: COLORS.onSurfaceSecondary, fontSize: 13, marginBottom: 12 },
  primaryBtn: { backgroundColor: COLORS.brand, paddingVertical: 12, borderRadius: RADIUS.md, alignItems: 'center' },
  primaryBtnText: { color: COLORS.onBrandPrimary, fontWeight: '700', fontSize: 14 },
  sectionLabel: { color: COLORS.onSurfaceSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginTop: SPACING.lg, marginBottom: SPACING.sm, paddingHorizontal: SPACING.lg },
  recentRow: { paddingHorizontal: SPACING.lg, gap: SPACING.md, paddingBottom: 4 },
  recentCard: { width: 160, marginRight: SPACING.sm },
  quickHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quickActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quickActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 5, paddingVertical: 4, borderRadius: RADIUS.pill, backgroundColor: COLORS.brandTertiary },
  recentName: { color: COLORS.onSurface, fontWeight: '700', fontSize: 14, marginTop: 8 },
  recentMeta: { color: COLORS.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12, borderBottomColor: 'rgba(255,255,255,0.04)', borderBottomWidth: 0.5 },
  iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: COLORS.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  rowName: { color: COLORS.onSurface, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: COLORS.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  folderArtBtn: { width: 36, height: 34, borderRadius: 17, backgroundColor: COLORS.brandTertiary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 1 },
  playPill: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.brand, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  folderPicker: { maxHeight: '72%', backgroundColor: COLORS.surfaceSecondary, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, paddingTop: SPACING.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  pickerTitle: { flex: 1, color: COLORS.onSurface, fontSize: 18, fontWeight: '800' },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SPACING.lg, paddingVertical: 12, borderBottomColor: 'rgba(255,255,255,0.04)', borderBottomWidth: 0.5 },
});
