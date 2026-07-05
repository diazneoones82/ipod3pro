import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Dimensions, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import ClickWheel, { type ClickWheelAction } from '@/src/components/ClickWheel';
import WaveformScrubber from '@/src/components/WaveformScrubber';
import SleepTimerSheet from '@/src/components/SleepTimerSheet';
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

function fmtSleep(sec: number): string {
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsText, setLyricsText] = useState('');
  const [lyricsTitle, setLyricsTitle] = useState('');

  const artSize = Math.min(SCREEN_W - 120, 230, SCREEN_H * 0.27);
  const wheelSize = Math.min(SCREEN_W - 120, 230, SCREEN_H * 0.27);
  const selectedTrack = player.queue[selectedIndex] ?? track;

  useEffect(() => {
    if (player.currentIndex >= 0) setSelectedIndex(player.currentIndex);
  }, [player.currentIndex]);

  const pulse = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  const selectOffset = useCallback((offset: number) => {
    if (player.queue.length === 0) return;
    setSelectedIndex((idx) => {
      const next = (idx + offset + player.queue.length) % player.queue.length;
      return next;
    });
  }, [player.queue.length]);

  const playSelected = useCallback(() => {
    if (wheelMode === 'track' && player.queue.length > 0) {
      if (selectedIndex === player.currentIndex) {
        player.togglePlay();
        return;
      }
      player.playQueueIndex(selectedIndex);
      return;
    }
    player.togglePlay();
  }, [player, selectedIndex, wheelMode]);

  const onWheelAction = useCallback((a: ClickWheelAction) => {
    switch (a) {
      case 'menu': router.push('/folders'); break;
      case 'play': playSelected(); break;
      case 'stop': player.stop(); break;
      case 'prev':
        if (wheelMode === 'track') selectOffset(-1);
        break;
      case 'next':
        if (wheelMode === 'track') selectOffset(1);
        break;
      case 'select':
        setWheelMode((m) => {
          const next = m === 'volume' ? 'track' : 'volume';
          if (next === 'track' && player.currentIndex >= 0) setSelectedIndex(player.currentIndex);
          return next;
        });
        break;
      case 'scrollUp':
        if (wheelMode === 'volume') {
          player.setVolume(player.volume + 0.03);
        } else selectOffset(1);
        break;
      case 'scrollDown':
        if (wheelMode === 'volume') {
          player.setVolume(player.volume - 0.03);
        } else selectOffset(-1);
        break;
    }
  }, [playSelected, player, router, selectOffset, wheelMode]);

  const progress01 = player.durationSec > 0 ? player.positionSec / player.durationSec : 0;
  const trackTitle = track?.filename?.replace(/\.[^.]+$/, '') ?? 'No track selected';
  const selectedTitle = selectedTrack?.filename?.replace(/\.[^.]+$/, '') ?? 'No track selected';
  const folderName = track?.folderName ?? 'Open folders to begin';
  const isFavorite = !!track && player.favorites.includes(track.id);
  const artUri = track?.artworkUri ?? DEFAULT_ART;

  const lyricQuery = useMemo(() => {
    if (!track) return '';
    return track.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }, [track]);

  const openLyrics = useCallback(async () => {
    if (!lyricQuery) return;
    setLyricsOpen(true);
    setLyricsLoading(true);
    setLyricsText('');
    setLyricsTitle(lyricQuery);
    try {
      const res = await fetch(`https://lrclib.net/api/search?track_name=${encodeURIComponent(lyricQuery)}`);
      const matches = await res.json();
      const match = Array.isArray(matches) ? matches.find((m) => m?.plainLyrics || m?.syncedLyrics) : null;
      setLyricsTitle(match?.trackName ? `${match.trackName}${match.artistName ? ` - ${match.artistName}` : ''}` : lyricQuery);
      setLyricsText(match?.plainLyrics || match?.syncedLyrics || 'No free lyrics found for this song.');
    } catch {
      setLyricsText('Lyrics could not be loaded right now.');
    } finally {
      setLyricsLoading(false);
    }
  }, [lyricQuery]);

  const actionButtons = [
    {
      id: 'favorite',
      icon: isFavorite ? 'heart' : 'heart-outline',
      active: isFavorite,
      onPress: () => track && player.toggleFavorite(track.id),
      disabled: !track,
    },
    {
      id: 'repeat',
      icon: 'repeat',
      active: player.repeat !== 'off',
      onPress: player.cycleRepeat,
      disabled: false,
    },
    {
      id: 'mute',
      icon: player.muted ? 'volume-mute' : 'volume-high',
      active: player.muted,
      onPress: player.toggleMute,
      disabled: false,
    },
    {
      id: 'lyrics',
      icon: 'document-text-outline',
      active: lyricsOpen,
      onPress: openLyrics,
      disabled: !track,
    },
  ] as const;

  return (
    <View style={[styles.container]}>
      <Image source={{ uri: BG_IMAGE }} style={StyleSheet.absoluteFill} blurRadius={Platform.OS === 'ios' ? 0 : 30} contentFit="cover" />
      <LinearGradient colors={['rgba(5,5,10,0.7)', 'rgba(5,5,10,0.95)', '#05050A']} style={StyleSheet.absoluteFill} />

      <View style={[styles.inner, { paddingTop: insets.top + 8 }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.brand}>Shuffle IMusic</Text>
          <View style={styles.headerRight}>
            <Pressable
              testID="sleep-timer-btn"
              onPress={() => setSleepOpen(true)}
              hitSlop={8}
              style={[styles.sleepBtn, player.sleepRemainingSec != null && styles.sleepBtnActive]}
            >
              <Ionicons name="moon" size={12} color={player.sleepRemainingSec != null ? COLORS.brand : COLORS.onSurfaceSecondary} />
              {player.sleepRemainingSec != null && (
                <Text style={styles.sleepRemaining}>{fmtSleep(player.sleepRemainingSec)}</Text>
              )}
            </Pressable>
            <View style={styles.modeBadge}>
              <View style={[styles.dot, { backgroundColor: wheelMode === 'volume' ? COLORS.brand : COLORS.success }]} />
              <Text style={styles.modeText}>{wheelMode === 'volume' ? `VOL ${Math.round(player.volume * 100)}` : 'TRACK'}</Text>
            </View>
          </View>
        </View>

        {/* Album art */}
        <View style={[styles.artWrap, { width: artSize, height: artSize, borderRadius: RADIUS.lg }]}>
          <Image source={{ uri: artUri }} style={[StyleSheet.absoluteFill, { borderRadius: RADIUS.lg }]} contentFit="cover" testID="album-art" />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)']} style={[StyleSheet.absoluteFill, { borderRadius: RADIUS.lg }]} start={{ x: 0.5, y: 0.4 }} end={{ x: 0.5, y: 1 }} />
          <View style={styles.artLabel}>
            <Ionicons name="musical-notes" size={14} color={COLORS.brand} />
            <Text style={styles.artLabelText} numberOfLines={1}>{folderName}</Text>
          </View>
        </View>

        {/* Track info */}
        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={1} testID="track-title">{trackTitle}</Text>
          <Text style={styles.trackMeta} numberOfLines={1}>
            {wheelMode === 'track' && player.queue.length > 0
              ? `Selected ${selectedIndex + 1}: ${selectedTitle}`
              : player.queue.length > 0 ? `Track ${player.currentIndex + 1} of ${player.queue.length}` : 'Tap MENU to choose a folder'}
          </Text>
        </View>

        {/* Waveform scrubber */}
        <View style={styles.waveRow}>
          <Text style={styles.time}>{fmtTime(player.positionSec)}</Text>
          <View style={{ flex: 1 }}>
            <WaveformScrubber
              testID="waveform-scrubber"
              progress={progress01}
              duration={player.durationSec}
              seed={track?.id || 'idle'}
              onSeek={player.seekTo}
            />
          </View>
          <Text style={styles.time}>{fmtTime(player.durationSec)}</Text>
        </View>

        <View style={styles.frontActions} testID="front-playback-options">
          {actionButtons.map((btn) => (
            <Pressable
              key={btn.id}
              testID={`front-${btn.id}`}
              disabled={btn.disabled}
              onPress={() => {
                pulse();
                btn.onPress();
              }}
              style={({ pressed }) => [
                styles.actionButton,
                btn.active && styles.actionButtonActive,
                btn.disabled && styles.actionButtonDisabled,
                { opacity: pressed ? 0.75 : btn.disabled ? 0.4 : 1 },
              ]}
            >
              <Ionicons name={btn.icon} size={18} color={btn.active ? COLORS.onBrandPrimary : COLORS.onSurface} />
            </Pressable>
          ))}
        </View>

        {/* Click wheel */}
        <View style={styles.wheelWrap}>
          <ClickWheel size={wheelSize} mode={wheelMode} onAction={onWheelAction} />
        </View>
      </View>

      <SleepTimerSheet visible={sleepOpen} onClose={() => setSleepOpen(false)} />
      <Modal visible={lyricsOpen} transparent animationType="slide" onRequestClose={() => setLyricsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.lyricsSheet}>
            <View style={styles.lyricsHeader}>
              <Text style={styles.lyricsTitle} numberOfLines={1}>{lyricsTitle || 'Lyrics'}</Text>
              <Pressable onPress={() => setLyricsOpen(false)} hitSlop={12} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={COLORS.onSurface} />
              </Pressable>
            </View>
            {lyricsLoading ? (
              <View style={styles.lyricsLoading}>
                <ActivityIndicator color={COLORS.brand} />
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.lyricsContent}>
                <Text style={styles.lyricsText}>{lyricsText}</Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  inner: { flex: 1, paddingHorizontal: SPACING.lg, alignItems: 'center' },
  header: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  brand: { color: COLORS.onSurface, fontSize: 20, fontWeight: '700', letterSpacing: 0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sleepBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.06)' },
  sleepBtnActive: { backgroundColor: COLORS.brandTertiary },
  sleepRemaining: { color: COLORS.brand, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  modeBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  modeText: { color: COLORS.onSurface, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  artWrap: { overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14, marginTop: SPACING.xs },
  artLabel: { position: 'absolute', bottom: 10, left: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  artLabelText: { color: COLORS.onSurface, fontSize: 11, fontWeight: '600', flexShrink: 1 },
  trackInfo: { marginTop: SPACING.sm, alignItems: 'center', width: '100%' },
  trackTitle: { color: COLORS.onSurface, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 2 },
  trackMeta: { color: COLORS.onSurfaceSecondary, fontSize: 12 },
  waveRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: SPACING.sm, gap: SPACING.sm },
  time: { color: COLORS.onSurfaceTertiary, fontSize: 11, width: 38, textAlign: 'center' },
  frontActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: SPACING.xs, minHeight: 34 },
  actionButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  actionButtonActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  actionButtonDisabled: { backgroundColor: 'rgba(255,255,255,0.04)' },
  wheelWrap: { marginTop: SPACING.xs, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  lyricsSheet: { maxHeight: '70%', backgroundColor: COLORS.surfaceSecondary, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, paddingTop: SPACING.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  lyricsHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm, gap: SPACING.md },
  lyricsTitle: { flex: 1, color: COLORS.onSurface, fontSize: 16, fontWeight: '700' },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  lyricsLoading: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  lyricsContent: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
  lyricsText: { color: COLORS.onSurface, fontSize: 14, lineHeight: 22 },
});
