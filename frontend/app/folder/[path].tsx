import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, Alert } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import { usePlayer, currentTrack } from '@/src/state/PlayerContext';
import { pullAlbumArtForFolder } from '@/src/utils/album-art';
import { trackLookupParts } from '@/src/utils/track-lookup';

const BRAND_LOGO_URI = 'data:image/png;base64,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';

export default function FolderDetail() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ path: string }>();
  const router = useRouter();
  const player = usePlayer();
  const [artDownloading, setArtDownloading] = useState(false);

  const folderPath = decodeURIComponent(params.path || '');
  const folder = useMemo(() => player.folders.find((f) => f.path === folderPath), [player.folders, folderPath]);
  const playing = currentTrack(player);

  const onTrackPress = (idx: number) => {
    if (!folder) return;
    player.playFolder(folder.path, idx);
    router.push('/(tabs)');
  };

  const handlePullAlbumArtForFolder = useCallback(async () => {
    if (!folder || artDownloading) return;
    setArtDownloading(true);
    try {
      const { updated, checked } = await pullAlbumArtForFolder(folder, player.artworkOverrides, player.setTrackArtwork);
      Alert.alert('Album art completed', `Updated ${updated} of ${checked} songs in ${folder.name}.`);
    } catch {
      Alert.alert('Album art unavailable', 'Album art could not be refreshed right now.');
    } finally {
      setArtDownloading(false);
    }
  }, [artDownloading, folder, player]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable testID="folder-back" onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{folder?.name ?? 'Folder'}</Text>
          <Text style={styles.subtitle}>{folder?.trackCount ?? 0} tracks</Text>
        </View>
        {folder && folder.trackCount > 0 && (
          <View style={styles.headerActions}>
            <Pressable
              testID="folder-art-all"
              disabled={artDownloading}
              onPress={handlePullAlbumArtForFolder}
              style={[styles.iconAction, artDownloading && { opacity: 0.55 }]}
            >
              <Ionicons name={artDownloading ? 'hourglass-outline' : 'images-outline'} size={17} color={COLORS.brand} />
            </Pressable>
            <Pressable
              testID="play-all"
              onPress={() => onTrackPress(0)}
              style={styles.playAll}
            >
              <Ionicons name="play" size={14} color={COLORS.onBrandPrimary} />
              <Text style={styles.playAllText}>Play all</Text>
            </Pressable>
          </View>
        )}
      </View>

      <FlatList
        data={folder?.tracks ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 140 }}
        renderItem={({ item, index }) => {
          const isPlaying = playing?.id === item.id;
          const artUri = player.artworkOverrides[item.id] ?? item.artworkUri;
          return (
            <Pressable testID={`track-row-${index}`} onPress={() => onTrackPress(index)} style={styles.row}>
              <View style={styles.thumbWrap}>
                <Image
                  source={artUri ? { uri: artUri } : { uri: BRAND_LOGO_URI }}
                  style={styles.thumb}
                  contentFit="cover"
                />
                <View style={[styles.idx, isPlaying && { backgroundColor: COLORS.brandTertiary }]}>
                  {isPlaying ? (
                    <Ionicons name="musical-notes" size={13} color={COLORS.brand} />
                  ) : (
                    <Text style={styles.idxText}>{index + 1}</Text>
                  )}
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.trackName, isPlaying && { color: COLORS.brand }]} numberOfLines={1}>
                  {trackLookupParts(item).title}
                </Text>
                <Text style={styles.trackMeta} numberOfLines={1}>
                  {[trackLookupParts(item).artist, trackLookupParts(item).album].filter(Boolean).join(' · ') ||
                    (item.duration ? `${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, '0')}` : '—')}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, marginBottom: SPACING.md, gap: SPACING.sm },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  title: { color: COLORS.onSurface, fontSize: 20, fontWeight: '700' },
  subtitle: { color: COLORS.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconAction: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.brandTertiary },
  playAll: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill },
  playAllText: { color: COLORS.onBrandPrimary, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, borderBottomColor: 'rgba(255,255,255,0.04)', borderBottomWidth: 0.5 },
  thumbWrap: { width: 42, height: 42 },
  thumb: { width: 42, height: 42, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.04)' },
  idx: { position: 'absolute', right: -3, bottom: -3, width: 19, height: 19, borderRadius: 9.5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.68)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  idxText: { color: COLORS.onSurfaceTertiary, fontSize: 12, fontWeight: '600' },
  trackName: { color: COLORS.onSurface, fontSize: 14, fontWeight: '600' },
  trackMeta: { color: COLORS.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
});
