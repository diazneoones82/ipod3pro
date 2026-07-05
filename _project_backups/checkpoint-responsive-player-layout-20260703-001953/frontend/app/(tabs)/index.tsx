import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Dimensions, Modal, ScrollView, ActivityIndicator, TextInput, FlatList, Linking, Alert, Vibration, Animated, Easing, Share } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import ClickWheel, { type ClickWheelAction } from '@/src/components/ClickWheel';
import WaveformScrubber from '@/src/components/WaveformScrubber';
import SleepTimerSheet from '@/src/components/SleepTimerSheet';
import { usePlayer, currentTrack, type VisualizerMode } from '@/src/state/PlayerContext';
import { fetchAlbumArt, fetchLyrics } from '@/src/utils/api';
import { cleanToken, trackLookupParts } from '@/src/utils/track-lookup';

const BG_IMAGE = 'https://images.pexels.com/photos/9807251/pexels-photo-9807251.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940';
const DEFAULT_ART = 'https://images.unsplash.com/photo-1585838017777-5003198884b5?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzN8MHwxfHNlYXJjaHwxfHx2aW50YWdlJTIwdmlueWwlMjByZWNvcmQlMjBjb3ZlciUyMGFydHxlbnwwfHx8fDE3ODI1MjcxMTZ8MA&ixlib=rb-4.1.0&q=85';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function normMatch(text?: string): string {
  return cleanToken(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function similarity(a?: string, b?: string): number {
  const aa = normMatch(a);
  const bb = normMatch(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) return 0.88;
  const aWords = new Set(aa.split(' '));
  const bWords = new Set(bb.split(' '));
  const overlap = [...aWords].filter((word) => bWords.has(word)).length;
  return overlap / Math.max(aWords.size, bWords.size);
}

function durationScore(candidateMs?: number, targetSec?: number): number {
  if (!candidateMs || !targetSec) return 0;
  const diff = Math.abs(candidateMs / 1000 - targetSec);
  if (diff <= 2) return 1;
  if (diff <= 6) return 0.75;
  if (diff <= 12) return 0.35;
  return -0.25;
}

function scoreCandidate(candidate: { title?: string; artist?: string; album?: string; durationMs?: number }, expected: { title: string; artist?: string; album?: string; duration?: number }): number {
  let score = similarity(candidate.title, expected.title) * 0.54;
  score += expected.artist ? similarity(candidate.artist, expected.artist) * 0.30 : 0.08;
  score += expected.album ? similarity(candidate.album, expected.album) * 0.10 : 0.04;
  score += durationScore(candidate.durationMs, expected.duration) * 0.08;
  return score;
}

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

function VisualizerStrip({ mode, isPlaying, seed }: { mode: VisualizerMode; isPlaying: boolean; seed: string }) {
  const count = mode === 'sea' ? 44 : 42;
  const seedValue = seed.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) || 17;
  const anims = React.useRef(Array.from({ length: 42 }, (_, i) => new Animated.Value(0.32 + ((seedValue + i * 13) % 46) / 100))).current;

  useEffect(() => {
    const loops = anims.slice(0, count).map((value, i) => {
      const high = 0.58 + ((seedValue + i * 17) % 38) / 100;
      const low = 0.16 + ((seedValue + i * 11) % 24) / 100;
      const speed = 420 + ((seedValue + i * 37) % 520);
      return Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: high, duration: speed, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(value, { toValue: low, duration: speed + 180, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
    });
    if (isPlaying) loops.forEach((loop) => loop.start());
    else anims.forEach((value, i) => value.setValue(0.24 + ((seedValue + i * 7) % 34) / 100));
    return () => loops.forEach((loop) => loop.stop());
  }, [anims, count, isPlaying, seedValue]);

  if (mode === 'sea') {
    return (
      <View style={styles.visualizerSea} testID="player-visualizer-sea" pointerEvents="none">
        {anims.slice(0, count).map((value, i) => (
          <Animated.View
            key={`sea-${i}`}
            style={[
              styles.seaBar,
              {
                opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.24, 0.84] }),
                transform: [
                  { scaleY: value.interpolate({ inputRange: [0, 1], outputRange: [0.32, 1.25] }) },
                  { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [3, -3] }) },
                ],
              },
            ]}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.visualizerBars} testID="player-visualizer-bars" pointerEvents="none">
      {anims.slice(0, count).map((value, i) => {
        const hue = i % 7;
        const colors = ['#FF2BD6', '#8B5CFF', '#00D9FF', '#20FF9F', '#C6FF00', '#FFD400', '#FF5C00'];
        return (
          <Animated.View
            key={`bar-${i}`}
            style={[
              styles.colorBar,
              {
                backgroundColor: colors[hue],
                opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.38, 0.95] }),
                transform: [{ scaleY: value.interpolate({ inputRange: [0, 1], outputRange: [0.24, 1.42] }) }],
              },
            ]}
          />
        );
      })}
    </View>
  );
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
  const [lyricsArtist, setLyricsArtist] = useState('');
  const [lyricsAlbum, setLyricsAlbum] = useState('');
  const [lyricsSource, setLyricsSource] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [artLoading, setArtLoading] = useState(false);

  const artSize = Math.min(SCREEN_W - 132, 218, SCREEN_H * 0.245);
  const wheelSize = Math.min(SCREEN_W - 118, 236, SCREEN_H * 0.275);
  const selectedTrack = player.queue[selectedIndex] ?? track;
  const searchableTracks = useMemo(() => player.folders.flatMap((folder) => folder.tracks), [player.folders]);
  const filteredTracks = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    const list = needle
      ? searchableTracks.filter((item) => `${item.filename} ${item.folderName}`.toLowerCase().includes(needle))
      : searchableTracks;
    return list.slice(0, 80);
  }, [searchQuery, searchableTracks]);

  useEffect(() => {
    if (player.currentIndex >= 0) setSelectedIndex(player.currentIndex);
  }, [player.currentIndex]);

  const pulse = useCallback(() => {
    const strength = Math.max(0, Math.min(100, player.wheelHapticStrength));
    if (strength <= 0) return;
    const style = strength >= 67
      ? Haptics.ImpactFeedbackStyle.Heavy
      : strength >= 34
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light;
    Haptics.impactAsync(style).catch(() => {});
    if (Platform.OS === 'android') Vibration.vibrate(Math.max(1, Math.round((strength / 100) * 34)));
  }, [player.wheelHapticStrength]);

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
        if (wheelMode === 'track') {
          const nextIndex = player.queue.length > 0
            ? (player.currentIndex - 1 + player.queue.length) % player.queue.length
            : -1;
          if (nextIndex >= 0) {
            setSelectedIndex(nextIndex);
            player.playQueueIndex(nextIndex);
          }
        }
        break;
      case 'next':
        if (wheelMode === 'track') {
          const nextIndex = player.queue.length > 0
            ? (player.currentIndex + 1) % player.queue.length
            : -1;
          if (nextIndex >= 0) {
            setSelectedIndex(nextIndex);
            player.playQueueIndex(nextIndex);
          }
        }
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
  const trackTitle = track ? trackLookupParts(track).title : 'No track selected';
  const selectedTitle = selectedTrack ? trackLookupParts(selectedTrack).title : 'No track selected';
  const folderName = track?.folderName ?? 'Open folders to begin';
  const isFavorite = !!track && player.favorites.includes(track.id);
  const artUri = (track && player.artworkOverrides[track.id]) || track?.artworkUri || DEFAULT_ART;

  const lyricQuery = useMemo(() => {
    if (!track) return '';
    return trackLookupParts(track).title;
  }, [track]);
  const lyricArtist = useMemo(() => track ? trackLookupParts(track).artist : undefined, [track]);
  const lyricAlbum = useMemo(() => track ? trackLookupParts(track).album : undefined, [track]);

  const openLyrics = useCallback(async () => {
    if (!lyricQuery) return;
    setLyricsOpen(true);
    setLyricsLoading(true);
    setLyricsText('');
    setLyricsTitle(lyricQuery);
    setLyricsArtist(lyricArtist || '');
    setLyricsAlbum(lyricAlbum || '');
    setLyricsSource('');
    try {
      const found = await fetchLyrics({ track: lyricQuery, artist: lyricArtist, album: lyricAlbum, duration: track?.duration });
      setLyricsTitle(found.title || lyricQuery);
      setLyricsArtist(found.artist || lyricArtist || '');
      setLyricsAlbum(found.album || '');
      setLyricsSource(found.source);
      setLyricsText(found.plainLyrics || found.syncedLyrics || 'No free lyrics found for this song.');
    } catch {
      try {
        const params = new URLSearchParams({ track_name: lyricQuery });
        if (lyricArtist) params.set('artist_name', lyricArtist);
        if (lyricAlbum) params.set('album_name', lyricAlbum);
        const res = await fetch(`https://lrclib.net/api/search?${params}`);
        const matches = await res.json();
        const match = Array.isArray(matches)
          ? matches
              .filter((m) => m?.plainLyrics || m?.syncedLyrics)
              .map((m) => ({
                item: m,
                score: scoreCandidate(
                  { title: m?.trackName, artist: m?.artistName, album: m?.albumName, durationMs: m?.duration ? Number(m.duration) * 1000 : undefined },
                  { title: lyricQuery, artist: lyricArtist, album: lyricAlbum, duration: track?.duration },
                ),
              }))
              .sort((a, b) => b.score - a.score)
              .find((m) => m.score >= (lyricArtist && lyricAlbum ? 0.76 : lyricArtist ? 0.72 : 0.58))?.item
          : null;
        setLyricsTitle(match?.trackName || lyricQuery);
        setLyricsArtist(match?.artistName || lyricArtist || '');
        setLyricsAlbum(match?.albumName || '');
        setLyricsSource(match ? 'LRCLIB' : '');
        setLyricsText(match?.plainLyrics || match?.syncedLyrics || 'No free lyrics found for this song.');
      } catch {
        setLyricsText('Lyrics could not be loaded right now.');
      }
    } finally {
      setLyricsLoading(false);
    }
  }, [lyricAlbum, lyricArtist, lyricQuery, track?.duration]);

  const openBluetoothShare = useCallback(async () => {
    pulse();
    const openBluetoothDevices = async () => {
      try {
        if (Platform.OS === 'android' && typeof (Linking as any).sendIntent === 'function') {
          await (Linking as any).sendIntent('android.settings.BLUETOOTH_SETTINGS');
          return;
        }
        await Linking.openSettings();
      } catch {
        Alert.alert('Bluetooth', 'Open Bluetooth settings from Android system settings.');
      }
    };
    if (!track) {
      await openBluetoothDevices();
      return;
    }
    Alert.alert('Share to Bluetooth', 'Choose Bluetooth from the share sheet, or open paired Bluetooth devices.', [
      { text: 'Devices', onPress: openBluetoothDevices },
      {
        text: 'Share song',
        onPress: () => {
          Sharing.shareAsync(track.uri, { mimeType: 'audio/*', dialogTitle: 'Share to Bluetooth' }).catch(() => {
            Alert.alert('Bluetooth share', 'Could not open the share sheet for this song.');
          });
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [pulse, track]);

  const addSongToPlaylist = useCallback(async (playlistId?: string) => {
    if (!track) return;
    pulse();
    try {
      const saved = await player.addTrackToPlaylist(track.id, playlistId, playlistName);
      if (saved) {
        setPlaylistName('');
        setPlaylistOpen(false);
        Alert.alert('Playlist', 'Song added to playlist.');
      }
    } catch {
      Alert.alert('Playlist', 'Could not add this song to a playlist.');
    }
  }, [playlistName, player, pulse, track]);

  const openPlaylistPicker = useCallback(() => {
    pulse();
    if (!track) {
      Alert.alert('Playlist', 'Play or select a song before adding it to a playlist.');
      return;
    }
    setPlaylistName('');
    setPlaylistOpen(true);
  }, [pulse, track]);

  const lyricsPayload = useMemo(() => {
    const title = lyricsTitle || lyricQuery || 'Lyrics';
    return [
      title,
      lyricsArtist ? `Artist: ${lyricsArtist}` : '',
      lyricsAlbum ? `Movie / Album: ${lyricsAlbum}` : '',
      lyricsSource ? `Source: ${lyricsSource}` : '',
      '',
      lyricsText,
    ].filter(Boolean).join('\n');
  }, [lyricQuery, lyricsAlbum, lyricsArtist, lyricsSource, lyricsText, lyricsTitle]);

  const shareLyrics = useCallback(async () => {
    if (!lyricsText.trim()) return;
    try {
      await Share.share({ title: lyricsTitle || 'Lyrics', message: lyricsPayload });
    } catch {
      Alert.alert('Lyrics', 'Could not open the Android share sheet.');
    }
  }, [lyricsPayload, lyricsText, lyricsTitle]);

  const downloadLyrics = useCallback(async () => {
    if (!lyricsText.trim()) return;
    try {
      const root = FileSystem.documentDirectory || FileSystem.cacheDirectory;
      if (!root) throw new Error('Storage unavailable');
      const dir = `${root}lyrics/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const safeName = `${lyricsTitle || lyricQuery || 'lyrics'}-${lyricsArtist || 'shuffle'}`.replace(/[^a-z0-9_-]+/gi, '_');
      const path = `${dir}${safeName}.txt`;
      await FileSystem.writeAsStringAsync(path, lyricsPayload);
      Alert.alert('Lyrics saved', 'Lyrics text saved in the app lyrics folder.', [
        { text: 'Share file', onPress: () => Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: 'Share lyrics text' }).catch(() => {}) },
        { text: 'OK' },
      ]);
    } catch {
      Alert.alert('Lyrics', 'Could not save lyrics text.');
    }
  }, [lyricQuery, lyricsArtist, lyricsPayload, lyricsText, lyricsTitle]);

  const showLyricsInEnglish = useCallback(async () => {
    if (!lyricsText.trim()) return;
    const text = lyricsText.length > 4800 ? lyricsText.slice(0, 4800) : lyricsText;
    const url = `https://translate.google.com/?sl=auto&tl=en&text=${encodeURIComponent(text)}&op=translate`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Translate', 'Could not open translation for these lyrics.');
    }
  }, [lyricsText]);

  const downloadAlbumArt = useCallback(async () => {
    if (!track || !lyricQuery || artLoading) return;
    setArtLoading(true);
    try {
      let url = '';
      try {
        const found = await fetchAlbumArt({ track: lyricQuery, artist: lyricArtist, album: lyricAlbum, duration: track.duration });
        url = found.artworkUrl;
      } catch {
        const term = [lyricArtist, lyricQuery, lyricAlbum].filter(Boolean).join(' ');
        const res = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=15&country=US&term=${encodeURIComponent(term)}`);
        const json = await res.json();
        const best = Array.isArray(json?.results)
          ? json.results
              .map((item: any) => ({
                item,
                score: scoreCandidate(
                  { title: item?.trackName, artist: item?.artistName, album: item?.collectionName, durationMs: item?.trackTimeMillis },
                  { title: lyricQuery, artist: lyricArtist, album: lyricAlbum, duration: track.duration },
                ),
              }))
              .sort((a: any, b: any) => b.score - a.score)
              .find((entry: any) => entry.score >= (lyricArtist && lyricAlbum ? 0.76 : lyricArtist ? 0.70 : 0.58))
          : null;
        url = best?.item?.artworkUrl100 ? String(best.item.artworkUrl100).replace(/100x100bb\.(jpg|png)$/i, '1200x1200bb.$1') : '';
      }
      if (!url) throw new Error('No artwork');
      const root = FileSystem.documentDirectory || FileSystem.cacheDirectory;
      if (!root) throw new Error('Storage unavailable');
      const dir = `${root}album-art/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const dest = `${dir}${track.id.replace(/[^a-z0-9_-]+/gi, '_')}.jpg`;
      const result = await FileSystem.downloadAsync(url, dest);
      player.setTrackArtwork(track.id, result.uri, track);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      Alert.alert('Album art', 'No internet album art found for this song.');
    } finally {
      setArtLoading(false);
    }
  }, [artLoading, lyricAlbum, lyricArtist, lyricQuery, player, track]);

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
    {
      id: 'art',
      icon: artLoading ? 'hourglass-outline' : 'image-outline',
      active: !!track && !!player.artworkOverrides[track.id],
      onPress: downloadAlbumArt,
      disabled: !track || artLoading,
    },
    {
      id: 'playlist',
      icon: 'settings-outline',
      active: false,
      onPress: openPlaylistPicker,
      disabled: false,
    },
    {
      id: 'bluetooth',
      icon: 'bluetooth-outline',
      active: false,
      onPress: openBluetoothShare,
      disabled: false,
    },
  ] as const;

  return (
    <View style={[styles.container]}>
      <Image source={{ uri: BG_IMAGE }} style={StyleSheet.absoluteFill} blurRadius={Platform.OS === 'ios' ? 0 : 30} contentFit="cover" />
      <LinearGradient colors={['rgba(5,5,10,0.7)', 'rgba(5,5,10,0.95)', '#05050A']} style={StyleSheet.absoluteFill} />

      <View style={[styles.inner, { paddingTop: insets.top + 8 }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image source={require('@/assets/images/shuffle-music-logo.png')} style={styles.brandLogo} contentFit="cover" />
            <Text style={styles.brand} numberOfLines={1}>Shuffle MuSic</Text>
          </View>
          <View style={styles.headerRight}>
            <Pressable
              testID="song-search-btn"
              onPress={() => setSearchOpen(true)}
              hitSlop={8}
              style={styles.iconHeaderBtn}
            >
              <Ionicons name="search" size={15} color={COLORS.onSurface} />
            </Pressable>
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

        {player.visualizerEnabled && (
          <VisualizerStrip
            mode={player.visualizerMode}
            isPlaying={player.isPlaying}
            seed={track?.id || 'idle'}
          />
        )}

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
          <ClickWheel size={wheelSize} mode={wheelMode} hapticStrength={player.wheelHapticStrength} onAction={onWheelAction} />
        </View>
      </View>

      <SleepTimerSheet visible={sleepOpen} onClose={() => setSleepOpen(false)} />
      <Modal visible={playlistOpen} transparent animationType="fade" onRequestClose={() => setPlaylistOpen(false)}>
        <View style={styles.searchBackdrop}>
          <View style={styles.searchSheet}>
            <View style={styles.searchHeader}>
              <Text style={styles.searchTitle}>Add to playlist</Text>
              <Pressable onPress={() => setPlaylistOpen(false)} hitSlop={12} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={COLORS.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.playlistSong} numberOfLines={1}>{trackTitle}</Text>
            <View style={styles.searchBox}>
              <Ionicons name="add" size={16} color={COLORS.onSurfaceTertiary} />
              <TextInput
                testID="playlist-name-input"
                value={playlistName}
                onChangeText={setPlaylistName}
                placeholder="New playlist name"
                placeholderTextColor={COLORS.onSurfaceTertiary}
                style={styles.searchInput}
                returnKeyType="done"
              />
              <Pressable
                testID="create-playlist-btn"
                disabled={!playlistName.trim()}
                onPress={() => addSongToPlaylist()}
                style={[styles.miniPill, !playlistName.trim() && styles.actionButtonDisabled]}
              >
                <Text style={styles.miniPillText}>Create</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 300 }}>
              {player.savedPlaylists.length === 0 ? (
                <Text style={styles.emptySearch}>Create a playlist to add this song</Text>
              ) : player.savedPlaylists.map((playlist) => (
                <Pressable
                  key={playlist.id}
                  testID={`playlist-${playlist.id}`}
                  style={styles.searchResult}
                  onPress={() => addSongToPlaylist(playlist.id)}
                >
                  <Ionicons name="list" size={16} color={COLORS.brand} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.searchResultTitle} numberOfLines={1}>{playlist.name}</Text>
                    <Text style={styles.searchResultMeta} numberOfLines={1}>{playlist.trackIds.length} songs</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal visible={searchOpen} transparent animationType="fade" onRequestClose={() => setSearchOpen(false)}>
        <View style={styles.searchBackdrop}>
          <View style={styles.searchSheet}>
            <View style={styles.searchHeader}>
              <Text style={styles.searchTitle}>Find songs</Text>
              <Pressable onPress={() => setSearchOpen(false)} hitSlop={12} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={COLORS.onSurface} />
              </Pressable>
            </View>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color={COLORS.onSurfaceTertiary} />
              <TextInput
                testID="song-search-input"
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Find songs"
                placeholderTextColor={COLORS.onSurfaceTertiary}
                style={styles.searchInput}
                autoFocus
                returnKeyType="search"
              />
            </View>
            <FlatList
              data={filteredTracks}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 360 }}
              ListEmptyComponent={<Text style={styles.emptySearch}>No songs found</Text>}
              renderItem={({ item }) => (
                <Pressable
                  testID={`song-result-${item.id}`}
                  style={styles.searchResult}
                  onPress={() => {
                    setSearchOpen(false);
                    setSearchQuery('');
                    player.playTrack(item);
                  }}
                >
                  <Ionicons name="musical-note" size={16} color={COLORS.brand} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.searchResultTitle} numberOfLines={1}>{item.filename.replace(/\.[^.]+$/, '')}</Text>
                    <Text style={styles.searchResultMeta} numberOfLines={1}>{item.folderName}</Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
      <Modal visible={lyricsOpen} transparent animationType="slide" onRequestClose={() => setLyricsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.lyricsSheet}>
            <View style={styles.lyricsHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lyricsTitle} numberOfLines={1}>{lyricsTitle || 'Lyrics'}</Text>
                {!!lyricsSource && <Text style={styles.lyricsSource}>Source: {lyricsSource}</Text>}
              </View>
              {!lyricsLoading && !!lyricsText && (
                <View style={styles.lyricsActions}>
                  <Pressable onPress={shareLyrics} hitSlop={8} style={styles.closeBtn}>
                    <Ionicons name="share-social-outline" size={18} color={COLORS.onSurface} />
                  </Pressable>
                  <Pressable onPress={downloadLyrics} hitSlop={8} style={styles.closeBtn}>
                    <Ionicons name="download-outline" size={18} color={COLORS.onSurface} />
                  </Pressable>
                  <Pressable onPress={showLyricsInEnglish} hitSlop={8} style={styles.closeBtn}>
                    <Ionicons name="language-outline" size={18} color={COLORS.onSurface} />
                  </Pressable>
                </View>
              )}
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
                <View style={styles.lyricsInfo}>
                  <Text style={styles.lyricsInfoLabel}>Song</Text>
                  <Text style={styles.lyricsInfoValue}>{lyricsTitle || lyricQuery}</Text>
                  {!!lyricsArtist && (
                    <>
                      <Text style={styles.lyricsInfoLabel}>Artist</Text>
                      <Text style={styles.lyricsInfoValue}>{lyricsArtist}</Text>
                    </>
                  )}
                  {!!lyricsAlbum && (
                    <>
                      <Text style={styles.lyricsInfoLabel}>Movie / Album</Text>
                      <Text style={styles.lyricsInfoValue}>{lyricsAlbum}</Text>
                    </>
                  )}
                  {!!lyricsSource && (
                    <>
                      <Text style={styles.lyricsInfoLabel}>Source</Text>
                      <Text style={styles.lyricsInfoValue}>{lyricsSource}</Text>
                    </>
                  )}
                </View>
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
  brandRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandLogo: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#050505' },
  brand: { flexShrink: 1, color: COLORS.onSurface, fontSize: 16, fontWeight: '800' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconHeaderBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
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
  visualizerSea: { width: '100%', height: 26, marginTop: 0, borderRadius: 12, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  seaBar: { width: 3, height: 15, borderRadius: 3, backgroundColor: '#00D9FF', shadowColor: '#00D9FF', shadowOpacity: 0.42, shadowRadius: 5 },
  visualizerBars: { width: '100%', height: 26, marginTop: 0, borderRadius: 12, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, backgroundColor: 'rgba(0,0,0,0.30)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  colorBar: { width: 3, height: 16, borderRadius: 3, shadowColor: '#FFFFFF', shadowOpacity: 0.24, shadowRadius: 4 },
  frontActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4, minHeight: 34 },
  actionButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  actionButtonActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  actionButtonDisabled: { backgroundColor: 'rgba(255,255,255,0.04)' },
  wheelWrap: { marginTop: 0, alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  searchBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' },
  searchSheet: { backgroundColor: COLORS.surfaceSecondary, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  searchHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md },
  searchTitle: { flex: 1, color: COLORS.onSurface, fontSize: 18, fontWeight: '800' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 42, borderRadius: RADIUS.md, backgroundColor: 'rgba(255,255,255,0.07)', marginBottom: SPACING.md },
  searchInput: { flex: 1, color: COLORS.onSurface, fontSize: 14, padding: 0 },
  searchResult: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)' },
  searchResultTitle: { color: COLORS.onSurface, fontSize: 14, fontWeight: '700' },
  searchResultMeta: { color: COLORS.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  emptySearch: { color: COLORS.onSurfaceTertiary, textAlign: 'center', paddingVertical: SPACING.xl },
  playlistSong: { color: COLORS.onSurfaceSecondary, fontSize: 12, fontWeight: '700', marginBottom: SPACING.sm },
  miniPill: { minWidth: 62, height: 30, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.brand, paddingHorizontal: 10 },
  miniPillText: { color: COLORS.onBrandPrimary, fontSize: 11, fontWeight: '800' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  lyricsSheet: { maxHeight: '70%', backgroundColor: COLORS.surfaceSecondary, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, paddingTop: SPACING.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  lyricsHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm, gap: SPACING.md },
  lyricsTitle: { flex: 1, color: COLORS.onSurface, fontSize: 16, fontWeight: '700' },
  lyricsSource: { color: COLORS.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  lyricsActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  lyricsLoading: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  lyricsContent: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
  lyricsInfo: { marginBottom: SPACING.md, paddingBottom: SPACING.md, borderBottomColor: 'rgba(255,255,255,0.08)', borderBottomWidth: 1 },
  lyricsInfoLabel: { color: COLORS.onSurfaceTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginTop: 8 },
  lyricsInfoValue: { color: COLORS.onSurface, fontSize: 13, fontWeight: '600', marginTop: 2 },
  lyricsText: { color: COLORS.onSurface, fontSize: 14, lineHeight: 22 },
});
