import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import ClickWheel, { type ClickWheelAction } from '@/src/components/ClickWheel';
import { usePlayer, currentTrack } from '@/src/state/PlayerContext';

const BG_IMAGE = 'https://images.pexels.com/photos/9807251/pexels-photo-9807251.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940';
const DEFAULT_ART = 'https://images.unsplash.com/photo-1585838017777-5003198884b5?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzN8MHwxfHNlYXJjaHwxfHx2aW50YWdlJTIwdmlueWwlMjByZWNvcmQlMjBjb3ZlciUyMGFydHxlbnwwfHx8fDE3ODI1MjcxMTZ8MA&ixlib=rb-4.1.0&q=85';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const player = usePlayer();
  const track = currentTrack(player);
  const [wheelMode, setWheelMode] = useState<'volume' | 'track'>('volume');

  // Determine wheel size responsive
  const wheelSize = Math.min(SCREEN_W - 64, 300, SCREEN_H * 0.36);

  const onWheelAction = useCallback((a: ClickWheelAction) => {
    switch (a) {
      case 'menu':
        router.push('/folders');
        break;
      case 'play':
        player.togglePlay();
        break;
      case 'prev':
        player.prev();
        break;
      case 'next':
        player.next();
        break;
      case 'select':
        // toggle wheel mode
        setWheelMode((m) => (m === 'volume' ? 'track' : 'volume'));
        break;
      case 'scrollUp':
        if (wheelMode === 'volume') player.setVolume(player.volume + 0.03);
        else player.next();
        break;
      case 'scrollDown':
        if (wheelMode === 'volume') player.setVolume(player.volume - 0.03);
        else player.prev();
        break;
    }
  }, [player, router, wheelMode]);

  const progressPct = player.durationSec > 0 ? (player.positionSec / player.durationSec) * 100 : 0;

  const trackTitle = track?.filename?.replace(/\.[^.]+$/, '') ?? 'No track selected';
  const folderName = track?.folderName ?? 'Open folders to begin';

  return (
    <View style={[styles.container]}>
      {/* Background */}
      <Image source={{ uri: BG_IMAGE }} style={StyleSheet.absoluteFill} blurRadius={Platform.OS === 'ios' ? 0 : 30} contentFit="cover" />
      <LinearGradient
        colors={['rgba(5,5,10,0.7)', 'rgba(5,5,10,0.95)', '#05050A']}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.inner, { paddingTop: insets.top + 8 }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.brand}>ChromeAmp</Text>
          <View style={styles.modeBadge}>
            <View style={[styles.dot, { backgroundColor: wheelMode === 'volume' ? COLORS.brand : COLORS.success }]} />
            <Text style={styles.modeText}>{wheelMode === 'volume' ? `VOL ${Math.round(player.volume * 100)}` : 'TRACK'}</Text>
          </View>
        </View>

        {/* Album art */}
        <View style={[styles.artWrap, { width: wheelSize, height: wheelSize, borderRadius: RADIUS.lg }]}>
          <Image
            source={{ uri: DEFAULT_ART }}
            style={[StyleSheet.absoluteFill, { borderRadius: RADIUS.lg }]}
            contentFit="cover"
            testID="album-art"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)']}
            style={[StyleSheet.absoluteFill, { borderRadius: RADIUS.lg }]}
            start={{ x: 0.5, y: 0.4 }}
            end={{ x: 0.5, y: 1 }}
          />
          <View style={styles.artLabel}>
            <Ionicons name="musical-notes" size={14} color={COLORS.brand} />
            <Text style={styles.artLabelText} numberOfLines={1}>{folderName}</Text>
          </View>
        </View>

        {/* Track info */}
        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={1} testID="track-title">{trackTitle}</Text>
          <Text style={styles.trackMeta} numberOfLines={1}>
            {player.queue.length > 0
              ? `Track ${player.currentIndex + 1} of ${player.queue.length}`
              : 'Tap MENU to choose a folder'}
          </Text>
        </View>

        {/* Progress */}
        <View style={styles.progressRow}>
          <Text style={styles.time}>{fmtTime(player.positionSec)}</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>
          <Text style={styles.time}>{fmtTime(player.durationSec)}</Text>
        </View>

        {/* Click wheel */}
        <View style={styles.wheelWrap}>
          <ClickWheel size={wheelSize} onAction={onWheelAction} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  inner: { flex: 1, paddingHorizontal: SPACING.lg, alignItems: 'center' },
  header: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  brand: { color: COLORS.onSurface, fontSize: 20, fontWeight: '700', letterSpacing: 0.5 },
  modeBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  modeText: { color: COLORS.onSurface, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  artWrap: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
    marginTop: SPACING.sm,
  },
  artLabel: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  artLabelText: { color: COLORS.onSurface, fontSize: 11, fontWeight: '600', flexShrink: 1 },
  trackInfo: { marginTop: SPACING.lg, alignItems: 'center', width: '100%' },
  trackTitle: { color: COLORS.onSurface, fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  trackMeta: { color: COLORS.onSurfaceSecondary, fontSize: 12 },
  progressRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: SPACING.md, gap: SPACING.sm },
  time: { color: COLORS.onSurfaceTertiary, fontSize: 11, width: 38, textAlign: 'center' },
  progressBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.brand },
  wheelWrap: { marginTop: SPACING.lg, alignItems: 'center', justifyContent: 'center', flex: 1 },
});
