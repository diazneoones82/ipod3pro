import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, FlatList, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import GlassCard from '@/src/components/GlassCard';
import { usePlayer, type FolderInfo } from '@/src/state/PlayerContext';

export default function FoldersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const player = usePlayer();
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!requested) {
      setRequested(true);
      setLoading(true);
      player.loadFolders().finally(() => setLoading(false));
    }
  }, [requested, player]);

  const recent = useMemo(() =>
    player.recentFolders
      .map((p) => player.folders.find((f) => f.path === p))
      .filter(Boolean) as FolderInfo[]
  , [player.recentFolders, player.folders]);

  const openFolder = (f: FolderInfo) => {
    router.push({ pathname: '/folder/[path]', params: { path: encodeURIComponent(f.path) } });
  };

  const playAll = (f: FolderInfo) => {
    player.playFolder(f.path, 0);
    router.push('/(tabs)');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <LinearGradient colors={['rgba(245,158,11,0.08)', 'transparent']} style={[StyleSheet.absoluteFill, { height: 240 }]} />
      <Text style={styles.title}>Storage</Text>
      <Text style={styles.subtitle}>Pick a folder to play all songs inside</Text>

      {!player.permissionGranted && !loading && (
        <GlassCard style={{ marginTop: SPACING.lg, marginHorizontal: SPACING.lg }}>
          <Text style={styles.permTitle}>Permission required</Text>
          <Text style={styles.permBody}>Shuffle IMusic needs access to read audio files on your device.</Text>
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
                  <Text style={styles.rowMeta}>{item.trackCount} tracks</Text>
                </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  title: { color: COLORS.onSurface, fontSize: 30, fontWeight: '800', paddingHorizontal: SPACING.lg, letterSpacing: -0.5 },
  subtitle: { color: COLORS.onSurfaceSecondary, fontSize: 13, paddingHorizontal: SPACING.lg, marginTop: 4 },
  permTitle: { color: COLORS.onSurface, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  permBody: { color: COLORS.onSurfaceSecondary, fontSize: 13, marginBottom: 12 },
  primaryBtn: { backgroundColor: COLORS.brand, paddingVertical: 12, borderRadius: RADIUS.md, alignItems: 'center' },
  primaryBtnText: { color: COLORS.onBrandPrimary, fontWeight: '700', fontSize: 14 },
  sectionLabel: { color: COLORS.onSurfaceSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginTop: SPACING.lg, marginBottom: SPACING.sm, paddingHorizontal: SPACING.lg },
  recentRow: { paddingHorizontal: SPACING.lg, gap: SPACING.md, paddingBottom: 4 },
  recentCard: { width: 160, marginRight: SPACING.sm },
  recentName: { color: COLORS.onSurface, fontWeight: '700', fontSize: 14, marginTop: 8 },
  recentMeta: { color: COLORS.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12, borderBottomColor: 'rgba(255,255,255,0.04)', borderBottomWidth: 0.5 },
  iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: COLORS.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  rowName: { color: COLORS.onSurface, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: COLORS.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  playPill: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.brand, alignItems: 'center', justifyContent: 'center' },
});
