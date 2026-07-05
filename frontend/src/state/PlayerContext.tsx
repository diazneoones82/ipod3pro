import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addNativeMediaActionListener, appendNativeDiagnosticsLog, consumePendingNativeMediaAction, exportNativeStartupLogcat, getNativeAudioMetadata, getNativeBackgroundDiagnostics, setNativeEqSession, updateNativeMediaStatus } from '@/src/native/ShuffleEqualizer';

export type Track = {
  id: string;
  uri: string;
  filename: string;
  title?: string;
  artist?: string;
  contributingArtist?: string;
  album?: string;
  albumId?: string;
  duration?: number; // seconds
  folder: string; // parent folder path
  folderName: string;
  artworkUri?: string;
};

export type FolderInfo = {
  path: string;
  name: string;
  trackCount: number;
  tracks: Track[];
};

export type LibraryScanResult = {
  folderCount: number;
  trackCount: number;
};

export type VisualizerMode = 'sea' | 'bars' | 'mist';

export type SavedPlaylist = {
  id: string;
  name: string;
  trackIds: string[];
  savedAt: number;
};

type PlayerState = {
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  isLoading: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';
  favorites: string[];
  artworkOverrides: Record<string, string>;
  folders: FolderInfo[];
  recentFolders: string[];
  quickFolderPaths: string[];
  currentFolderPath: string | null;
  permissionGranted: boolean;
  // new
  sleepTimerEnd: number | null; // ms epoch
  sleepRemainingSec: number | null;
  gaplessEnabled: boolean;
  wheelHapticStrength: number;
  visualizerEnabled: boolean;
  visualizerMode: VisualizerMode;
  savedPlaylists: SavedPlaylist[];
};

type PlayerActions = {
  loadFolders: () => Promise<LibraryScanResult>;
  playFolder: (folderPath: string, startIndex?: number) => Promise<void>;
  playTrack: (track: Track) => Promise<void>;
  playQueueIndex: (idx: number) => Promise<void>;
  togglePlay: () => void;
  stop: () => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seekTo: (sec: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleFavorite: (trackId: string) => void;
  setTrackArtwork: (trackId: string, uri: string, track?: Track) => void;
  addQuickFolder: (folderPath: string) => void;
  removeQuickFolder: (folderPath: string) => void;
  setPermissionGranted: (granted: boolean) => void;
  setSleepTimer: (minutes: number | null) => void;
  setGapless: (v: boolean) => void;
  setWheelHapticStrength: (v: number) => void;
  setVisualizerEnabled: (v: boolean) => void;
  setVisualizerMode: (mode: VisualizerMode) => void;
  addTrackToPlaylist: (trackId: string, playlistId?: string, playlistName?: string) => Promise<boolean>;
};

const PlayerCtx = createContext<(PlayerState & PlayerActions) | null>(null);

const RECENT_KEY = '@shuffleimusic/recent_folders';
const QUICK_FOLDERS_KEY = '@shuffleimusic/quick_folders';
const VOLUME_KEY = '@shuffleimusic/volume';
const GAPLESS_KEY = '@shuffleimusic/gapless';
const WHEEL_HAPTIC_KEY = '@shuffleimusic/wheel_haptic_strength';
const VISUALIZER_ENABLED_KEY = '@shuffleimusic/visualizer_enabled';
const VISUALIZER_MODE_KEY = '@shuffleimusic/visualizer_mode';
const FAVORITES_KEY = '@shuffleimusic/favorites';
const ARTWORK_KEY = '@shuffleimusic/artwork_overrides';
const LAST_STATE_KEY = '@shuffleimusic/last_state';
const PLAYLISTS_KEY = '@shuffleimusic/playlists';

type LastPlayerState = {
  folderPath: string | null;
  trackId: string | null;
  positionSec: number;
};

function parseFolder(uri: string, fallbackFolder = 'unknown', fallbackName = 'Unknown') {
  let folderPath = fallbackFolder;
  let folderName = fallbackName;
  if (uri.startsWith('file://')) {
    const parts = uri.replace('file://', '').split('/');
    parts.pop();
    folderPath = parts.join('/') || fallbackFolder;
    folderName = parts[parts.length - 1] || fallbackName;
  } else if (uri.includes('/')) {
    const parts = uri.split('/');
    parts.pop();
    folderPath = parts.join('/') || fallbackFolder;
    folderName = parts[parts.length - 1] || fallbackName;
  }
  return { folderPath, folderName };
}

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, '').toLowerCase();
}

function coverKey(folderPath: string, name: string) {
  return `${folderPath}/${stripExt(name)}`;
}

function displayTrackTitle(track: Track | null) {
  return track?.title?.trim() || track?.filename?.replace(/\.[^.]+$/, '') || 'Shuffle MuSic';
}

export function trackArtworkKey(track: Track) {
  return [
    track.title || track.filename.replace(/\.[^.]+$/, ''),
    track.artist || track.contributingArtist || '',
    track.album || '',
    Math.round(track.duration || 0),
  ].map((part) => String(part).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')).join('|');
}

function syncPlayerEqSession(player: AudioPlayer | null) {
  const sessionId = Number((player as any)?.audioSessionId ?? 0);
  if (Number.isFinite(sessionId) && sessionId > 0) {
    setNativeEqSession(sessionId).catch(() => {});
  } else {
    setNativeEqSession(0).catch(() => {});
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const nextPlayerRef = useRef<AudioPlayer | null>(null);
  const nextPreloadedFor = useRef<string | null>(null);
  const activePlayerIdRef = useRef(0);
  const pausedForCallRef = useRef(false);
  const restoredLastStateRef = useRef(false);
  const autoLoadedLibraryRef = useRef(false);
  const expectedPlayingRef = useRef(false);
  const unexpectedStopLoggedRef = useRef(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'one' | 'all'>('off');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [artworkOverrides, setArtworkOverrides] = useState<Record<string, string>>({});
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [quickFolderPaths, setQuickFolderPaths] = useState<string[]>([]);
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [sleepTimerEnd, setSleepTimerEnd] = useState<number | null>(null);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
  const [gaplessEnabled, setGaplessEnabled] = useState(true);
  const [wheelHapticStrength, setWheelHapticStrengthState] = useState(70);
  const [visualizerEnabled, setVisualizerEnabledState] = useState(true);
  const [visualizerMode, setVisualizerModeState] = useState<VisualizerMode>('bars');
  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylist[]>([]);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {});
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
    }
    (async () => {
      const v = await AsyncStorage.getItem(VOLUME_KEY);
      if (v != null) setVolumeState(parseFloat(v));
      const r = await AsyncStorage.getItem(RECENT_KEY);
      if (r) try { setRecentFolders(JSON.parse(r)); } catch {}
      const q = await AsyncStorage.getItem(QUICK_FOLDERS_KEY);
      if (q) try { setQuickFolderPaths(JSON.parse(q)); } catch {}
      const g = await AsyncStorage.getItem(GAPLESS_KEY);
      if (g != null) setGaplessEnabled(g === 'true');
      const wh = await AsyncStorage.getItem(WHEEL_HAPTIC_KEY);
      if (wh != null) setWheelHapticStrengthState(Math.max(0, Math.min(100, Number(wh) || 0)));
      const viz = await AsyncStorage.getItem(VISUALIZER_ENABLED_KEY);
      if (viz != null) setVisualizerEnabledState(viz === 'true');
      const vizMode = await AsyncStorage.getItem(VISUALIZER_MODE_KEY);
      if (vizMode === 'sea' || vizMode === 'bars' || vizMode === 'mist') setVisualizerModeState(vizMode);
      const fav = await AsyncStorage.getItem(FAVORITES_KEY);
      if (fav) try { setFavorites(JSON.parse(fav)); } catch {}
      const art = await AsyncStorage.getItem(ARTWORK_KEY);
      if (art) try { setArtworkOverrides(JSON.parse(art)); } catch {}
      const playlists = await AsyncStorage.getItem(PLAYLISTS_KEY);
      if (playlists) try { setSavedPlaylists(JSON.parse(playlists)); } catch {}
    })().finally(() => {
      setStorageReady(true);
      appendNativeDiagnosticsLog('app_started storage_ready=true').catch(() => {});
      exportNativeStartupLogcat().catch(() => {});
      getNativeBackgroundDiagnostics()
        .then((diag) => appendNativeDiagnosticsLog(`background_diagnostics=${JSON.stringify(diag)}`))
        .catch(() => {});
    });
  }, []);

  // Position polling + sleep timer countdown + gapless preload trigger
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (p) {
        setPositionSec(p.currentTime ?? 0);
        if (p.duration && Number.isFinite(p.duration)) setDurationSec(p.duration);
        setIsPlaying(!!p.playing);
        if (expectedPlayingRef.current && !p.playing && !isLoading) {
          if (!unexpectedStopLoggedRef.current) {
            unexpectedStopLoggedRef.current = true;
            const track = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
            getNativeBackgroundDiagnostics()
              .then((diag) => appendNativeDiagnosticsLog(`unexpected_playback_stop title="${displayTrackTitle(track)}" position=${p.currentTime ?? 0} duration=${p.duration ?? 0} diagnostics=${JSON.stringify(diag)}`))
              .catch(() => {});
          }
        } else if (p.playing) {
          unexpectedStopLoggedRef.current = false;
        }
      }
      if (sleepTimerEnd != null) {
        const remaining = Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 1000));
        setSleepRemainingSec(remaining);
        if (remaining <= 0) {
          try { playerRef.current?.pause(); } catch {}
          try { nextPlayerRef.current?.pause(); } catch {}
          try { nextPlayerRef.current?.remove(); } catch {}
          nextPlayerRef.current = null;
          nextPreloadedFor.current = null;
          expectedPlayingRef.current = false;
          appendNativeDiagnosticsLog('sleep_timer_pause').catch(() => {});
          setIsPlaying(false);
          setSleepTimerEnd(null);
          setSleepRemainingSec(null);
        }
      } else if (sleepRemainingSec != null) {
        setSleepRemainingSec(null);
      }
      // Gapless preload ~4s before track end
      if (gaplessEnabled && p && durationSec > 5 && repeat !== 'one') {
        const remain = durationSec - (p.currentTime ?? 0);
        const nextIdx = (currentIndex + 1) % queue.length;
        const nextTrack = queue[nextIdx];
        if (remain > 0 && remain < 4 && nextTrack && nextPreloadedFor.current !== nextTrack.id) {
          try {
            if (nextPlayerRef.current) {
              try { nextPlayerRef.current.pause(); } catch {}
              try { nextPlayerRef.current.remove(); } catch {}
            }
            const np = createAudioPlayer({ uri: nextTrack.uri }, { keepAudioSessionActive: true });
            np.volume = 0;
            nextPlayerRef.current = np;
            nextPreloadedFor.current = nextTrack.id;
          } catch {}
        }
      }
    }, 500);
    return () => clearInterval(id);
  }, [sleepTimerEnd, sleepRemainingSec, gaplessEnabled, durationSec, currentIndex, queue, repeat, isLoading]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const playerId = activePlayerIdRef.current;
    const sub = p.addListener('playbackStatusUpdate', (status: any) => {
      if (playerRef.current !== p || activePlayerIdRef.current !== playerId) return;
      if (status?.didJustFinish) handleTrackEnd();
    });
    return () => { sub?.remove?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, queue.length, repeat, shuffle, gaplessEnabled]);

  const persistRecent = useCallback(async (list: string[]) => {
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
  }, []);

  const persistQuickFolders = useCallback(async (list: string[]) => {
    await AsyncStorage.setItem(QUICK_FOLDERS_KEY, JSON.stringify(list.slice(0, 20)));
  }, []);

  const disposePlayer = useCallback((p: AudioPlayer | null) => {
    if (!p) return;
    try { p.pause(); } catch {}
    try { p.seekTo(0); } catch {}
    try { p.remove(); } catch {}
  }, []);

  const clearPreload = useCallback(() => {
    disposePlayer(nextPlayerRef.current);
    nextPlayerRef.current = null;
    nextPreloadedFor.current = null;
  }, [disposePlayer]);

  const setupPlayer = useCallback((uri: string): AudioPlayer => {
    disposePlayer(playerRef.current);
    playerRef.current = null;
    const p = createAudioPlayer({ uri }, { keepAudioSessionActive: true });
    p.volume = muted ? 0 : volume;
    playerRef.current = p;
    syncPlayerEqSession(p);
    return p;
  }, [disposePlayer, muted, volume]);

  const playTrackAtIndex = useCallback(async (idx: number, list: Track[]) => {
    if (idx < 0 || idx >= list.length) return;
    const playerId = activePlayerIdRef.current + 1;
    activePlayerIdRef.current = playerId;
    setIsLoading(true);
    const t = list[idx];

    // Try to use the preloaded next-track player for gapless transitions
    let p: AudioPlayer;
    if (gaplessEnabled && nextPlayerRef.current && nextPreloadedFor.current === t.id) {
      disposePlayer(playerRef.current);
      playerRef.current = null;
      p = nextPlayerRef.current;
      p.volume = muted ? 0 : volume;
      playerRef.current = p;
      syncPlayerEqSession(p);
      nextPlayerRef.current = null;
      nextPreloadedFor.current = null;
    } else {
      clearPreload();
      p = setupPlayer(t.uri);
    }
    if (activePlayerIdRef.current !== playerId) {
      disposePlayer(p);
      setIsLoading(false);
      return;
    }
    setCurrentIndex(idx);
    setPositionSec(0);
    setDurationSec(t.duration ?? 0);
    try {
      p.play();
      expectedPlayingRef.current = true;
      unexpectedStopLoggedRef.current = false;
      appendNativeDiagnosticsLog(`play title="${displayTrackTitle(t)}" index=${idx} length=${list.length}`).catch(() => {});
      syncPlayerEqSession(p);
      setTimeout(() => syncPlayerEqSession(p), 250);
      setIsPlaying(true);
    } catch {}
    setIsLoading(false);
  }, [clearPreload, disposePlayer, setupPlayer, gaplessEnabled, muted, volume]);

  const handleTrackEnd = useCallback(() => {
    if (repeat === 'one') {
      appendNativeDiagnosticsLog(`track_end repeat_one index=${currentIndex}`).catch(() => {});
      playTrackAtIndex(currentIndex, queue);
      return;
    }
    let n = currentIndex + 1;
    if (shuffle && queue.length > 1) n = Math.floor(Math.random() * queue.length);
    if (n >= queue.length) {
      if (repeat === 'all') n = 0;
      else {
        expectedPlayingRef.current = false;
        appendNativeDiagnosticsLog(`queue_finished index=${currentIndex} length=${queue.length}`).catch(() => {});
        setIsPlaying(false);
        return;
      }
    }
    appendNativeDiagnosticsLog(`track_end next_index=${n} length=${queue.length}`).catch(() => {});
    playTrackAtIndex(n, queue);
  }, [repeat, shuffle, currentIndex, queue, playTrackAtIndex]);

  const loadFolders = useCallback(async (): Promise<LibraryScanResult> => {
    try {
      const MediaLibrary = await import('expo-media-library');
      const perm = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
      if (!perm.granted) {
        setPermissionGranted(false);
        return { folderCount: 0, trackCount: 0 };
      }
      setPermissionGranted(true);
      let all: any[] = [];
      let after: string | undefined;
      for (let i = 0; i < 20; i++) {
        const page: any = await MediaLibrary.getAssetsAsync({
          mediaType: MediaLibrary.MediaType.audio,
          first: 200,
          after,
          sortBy: [MediaLibrary.SortBy.creationTime],
        });
        all = all.concat(page.assets || []);
        if (!page.hasNextPage) break;
        after = page.endCursor;
      }
      const imageByExactName = new Map<string, string>();
      const imageByFolderCover = new Map<string, string>();
      const map = new Map<string, FolderInfo>();
      const metadataById = await getNativeAudioMetadata(all.map((a) => String(a.id)).filter(Boolean));
      for (const a of all) {
        const uri: string = a.uri || a.localUri || '';
        const filename: string = a.filename || 'Unknown';
        const meta = metadataById[String(a.id)] || {};
        let { folderPath, folderName } = parseFolder(uri);
        // Fallback to album grouping if we can't parse the path
        if (folderPath === 'unknown' && a.albumId) {
          folderPath = `album:${a.albumId}`;
          folderName = meta.album || a.album || 'Album';
        }
        const artworkUri = imageByExactName.get(coverKey(folderPath, filename)) ?? imageByFolderCover.get(folderPath);
        const track: Track = {
          id: a.id,
          uri,
          filename,
          title: meta.title,
          artist: meta.artist,
          contributingArtist: meta.contributingArtist || meta.artist,
          album: meta.album,
          albumId: meta.albumId || a.albumId,
          duration: meta.durationMs ? meta.durationMs / 1000 : a.duration,
          folder: folderPath,
          folderName,
          artworkUri,
        };
        const persistedArtwork = artworkOverrides[track.id] || artworkOverrides[trackArtworkKey(track)];
        if (persistedArtwork) track.artworkUri = persistedArtwork;
        if (!map.has(folderPath)) {
          map.set(folderPath, { path: folderPath, name: folderName, trackCount: 0, tracks: [] });
        }
        const f = map.get(folderPath)!;
        f.tracks.push(track);
        f.trackCount = f.tracks.length;
      }
      const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
      setFolders(list);
      if (!restoredLastStateRef.current) {
        restoredLastStateRef.current = true;
        const rawLast = await AsyncStorage.getItem(LAST_STATE_KEY).catch(() => null);
        if (rawLast) {
          try {
            const last = JSON.parse(rawLast) as LastPlayerState;
            const folder = list.find((f) => f.path === last.folderPath) || list.find((f) => f.tracks.some((t) => t.id === last.trackId));
            const idx = folder?.tracks.findIndex((t) => t.id === last.trackId) ?? -1;
            if (folder && idx >= 0) {
              setQueue(folder.tracks);
              setCurrentFolderPath(folder.path);
              setCurrentIndex(idx);
              setPositionSec(Math.max(0, last.positionSec || 0));
              setDurationSec(folder.tracks[idx]?.duration ?? 0);
              const p = setupPlayer(folder.tracks[idx].uri);
              const seek = Math.max(0, last.positionSec || 0);
              if (seek > 0) setTimeout(() => p.seekTo(seek), 250);
            }
          } catch {}
        }
      }
      return {
        folderCount: list.length,
        trackCount: list.reduce((sum, f) => sum + f.trackCount, 0),
      };
    } catch (e) {
      console.warn('loadFolders error', e);
      return {
        folderCount: 0,
        trackCount: 0,
      };
    }
  }, [artworkOverrides, setupPlayer]);

  useEffect(() => {
    if (!storageReady) return;
    if (autoLoadedLibraryRef.current) return;
    autoLoadedLibraryRef.current = true;
    loadFolders().catch(() => {});
  }, [loadFolders, storageReady]);

  const playFolder = useCallback(async (folderPath: string, startIndex = 0) => {
    const f = folders.find((x) => x.path === folderPath);
    if (!f || f.tracks.length === 0) return;
    setQueue(f.tracks);
    setCurrentFolderPath(folderPath);
    const recent = [folderPath, ...recentFolders.filter((p) => p !== folderPath)].slice(0, 10);
    setRecentFolders(recent);
    persistRecent(recent);
    await playTrackAtIndex(startIndex, f.tracks);
  }, [folders, recentFolders, playTrackAtIndex, persistRecent]);

  const playTrack = useCallback(async (track: Track) => {
    const f = folders.find((x) => x.path === track.folder);
    const list = f ? f.tracks : [track];
    setQueue(list);
    setCurrentFolderPath(track.folder);
    const idx = list.findIndex((t) => t.id === track.id);
    await playTrackAtIndex(idx >= 0 ? idx : 0, list);
  }, [folders, playTrackAtIndex]);

  const playQueueIndex = useCallback(async (idx: number) => {
    await playTrackAtIndex(idx, queue);
  }, [playTrackAtIndex, queue]);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) {
      expectedPlayingRef.current = false;
      p.pause();
      appendNativeDiagnosticsLog(`pause position=${p.currentTime ?? 0}`).catch(() => {});
      setIsPlaying(false);
    }
    else {
      expectedPlayingRef.current = true;
      unexpectedStopLoggedRef.current = false;
      p.play();
      appendNativeDiagnosticsLog(`resume position=${p.currentTime ?? 0}`).catch(() => {});
      setIsPlaying(true);
    }
  }, []);

  const stop = useCallback(() => {
    activePlayerIdRef.current += 1;
    clearPreload();
    const p = playerRef.current;
    if (!p) return;
    try { p.pause(); p.seekTo(0); } catch {}
    expectedPlayingRef.current = false;
    appendNativeDiagnosticsLog('stop').catch(() => {});
    setIsPlaying(false);
    setPositionSec(0);
  }, [clearPreload]);

  const next = useCallback(async () => {
    if (queue.length === 0) return;
    let n = currentIndex + 1;
    if (shuffle) n = Math.floor(Math.random() * queue.length);
    if (n >= queue.length) n = 0;
    await playTrackAtIndex(n, queue);
  }, [queue, currentIndex, shuffle, playTrackAtIndex]);

  const prev = useCallback(async () => {
    if (queue.length === 0) return;
    if (positionSec > 3) { playerRef.current?.seekTo(0); return; }
    let n = currentIndex - 1;
    if (n < 0) n = queue.length - 1;
    await playTrackAtIndex(n, queue);
  }, [queue, currentIndex, positionSec, playTrackAtIndex]);

  const seekTo = useCallback((sec: number) => {
    playerRef.current?.seekTo(sec);
    setPositionSec(sec);
  }, []);

  const setVolume = useCallback((vol: number) => {
    const v = Math.max(0, Math.min(1, vol));
    setVolumeState(v);
    if (playerRef.current) playerRef.current.volume = muted ? 0 : v;
    AsyncStorage.setItem(VOLUME_KEY, String(v)).catch(() => {});
  }, [muted]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const nextMuted = !m;
      if (playerRef.current) playerRef.current.volume = nextMuted ? 0 : volume;
      return nextMuted;
    });
  }, [volume]);

  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);
  const cycleRepeat = useCallback(() => setRepeat((r) => r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'), []);
  const toggleFavorite = useCallback((trackId: string) => {
    setFavorites((list) => {
      const next = list.includes(trackId) ? list.filter((id) => id !== trackId) : [trackId, ...list];
      AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const setTrackArtwork = useCallback((trackId: string, uri: string, track?: Track) => {
    setArtworkOverrides((map) => {
      const next = { ...map, [trackId]: uri };
      if (track) next[trackArtworkKey(track)] = uri;
      AsyncStorage.setItem(ARTWORK_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const addQuickFolder = useCallback((folderPath: string) => {
    setQuickFolderPaths((list) => {
      const next = [folderPath, ...list.filter((p) => p !== folderPath)].slice(0, 20);
      persistQuickFolders(next);
      return next;
    });
  }, [persistQuickFolders]);

  const removeQuickFolder = useCallback((folderPath: string) => {
    setQuickFolderPaths((list) => {
      const next = list.filter((p) => p !== folderPath);
      persistQuickFolders(next);
      return next;
    });
  }, [persistQuickFolders]);

  const setSleepTimer = useCallback((minutes: number | null) => {
    if (minutes == null || minutes <= 0) {
      setSleepTimerEnd(null);
      setSleepRemainingSec(null);
      return;
    }
    setSleepTimerEnd(Date.now() + minutes * 60 * 1000);
    setSleepRemainingSec(minutes * 60);
  }, []);

  const setGapless = useCallback((v: boolean) => {
    if (!v) clearPreload();
    setGaplessEnabled(v);
    AsyncStorage.setItem(GAPLESS_KEY, String(v)).catch(() => {});
  }, [clearPreload]);

  const setWheelHapticStrength = useCallback((v: number) => {
    const next = Math.max(0, Math.min(100, Math.round(v)));
    setWheelHapticStrengthState(next);
    AsyncStorage.setItem(WHEEL_HAPTIC_KEY, String(next)).catch(() => {});
  }, []);

  const setVisualizerEnabled = useCallback((v: boolean) => {
    setVisualizerEnabledState(v);
    AsyncStorage.setItem(VISUALIZER_ENABLED_KEY, String(v)).catch(() => {});
  }, []);

  const setVisualizerMode = useCallback((mode: VisualizerMode) => {
    setVisualizerModeState(mode);
    AsyncStorage.setItem(VISUALIZER_MODE_KEY, mode).catch(() => {});
  }, []);

  const addTrackToPlaylist = useCallback(async (trackId: string, playlistId?: string, playlistName?: string) => {
    if (!trackId) return false;
    setSavedPlaylists((list) => {
      const name = playlistName?.trim();
      let updated: SavedPlaylist[];
      if (playlistId) {
        let found = false;
        updated = list.map((playlist) => {
          if (playlist.id !== playlistId) return playlist;
          found = true;
          return {
            ...playlist,
            trackIds: playlist.trackIds.includes(trackId) ? playlist.trackIds : [...playlist.trackIds, trackId],
            savedAt: Date.now(),
          };
        });
        if (!found) updated = list;
      } else {
        const next: SavedPlaylist = {
          id: `${Date.now()}`,
          name: name || `Playlist ${list.length + 1}`,
          trackIds: [trackId],
          savedAt: Date.now(),
        };
        updated = [next, ...list].slice(0, 25);
      }
      AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    return true;
  }, []);

  useEffect(() => {
    const track = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
    if (!track && !currentFolderPath) return;
    AsyncStorage.setItem(LAST_STATE_KEY, JSON.stringify({
      folderPath: currentFolderPath || track?.folder || null,
      trackId: track?.id || null,
      positionSec: Math.max(0, positionSec || 0),
    } satisfies LastPlayerState)).catch(() => {});
  }, [currentFolderPath, currentIndex, positionSec, queue]);

  const handleMediaAction = useCallback((action: string | null | undefined) => {
    if (action) appendNativeDiagnosticsLog(`js_media_action=${action}`).catch(() => {});
    if (action === 'toggle') togglePlay();
    else if (action === 'play') {
      if (!playerRef.current?.playing) togglePlay();
    } else if (action === 'pause') {
      if (playerRef.current?.playing) togglePlay();
    } else if (action === 'audio_focus_loss') {
      if (playerRef.current?.playing) {
        expectedPlayingRef.current = false;
        togglePlay();
      }
    } else if (action === 'phone_pause') {
      if (playerRef.current?.playing) {
        pausedForCallRef.current = true;
        expectedPlayingRef.current = false;
        togglePlay();
      }
    } else if (action === 'phone_resume') {
      if (pausedForCallRef.current && playerRef.current && !playerRef.current.playing) {
        pausedForCallRef.current = false;
        togglePlay();
      }
    } else if (action === 'volume_up') {
      setVolume(volume + 0.06);
    } else if (action === 'volume_down') {
      setVolume(volume - 0.06);
    } else if (action === 'next') {
      next();
    } else if (action === 'previous') {
      prev();
    } else if (action === 'stop') {
      stop();
    }
  }, [next, prev, setVolume, stop, togglePlay, volume]);

  const handleMediaUrl = useCallback((url: string | null) => {
    if (!url?.startsWith('shuffleimusic://media')) return;
    handleMediaAction(url.match(/[?&]action=([^&]+)/)?.[1]);
  }, [handleMediaAction]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => handleMediaUrl(url));
    Linking.getInitialURL().then(handleMediaUrl).catch(() => {});
    return () => sub.remove();
  }, [handleMediaUrl]);

  useEffect(() => {
    const sub = addNativeMediaActionListener(handleMediaAction);
    consumePendingNativeMediaAction().then(handleMediaAction).catch(() => {});
    return () => sub.remove();
  }, [handleMediaAction]);

  useEffect(() => {
    const track = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
    const artworkUri = track ? artworkOverrides[track.id] || track.artworkUri : undefined;
    updateNativeMediaStatus(
      displayTrackTitle(track),
      track?.artist || track?.album || track?.folderName || (queue.length ? `Track ${currentIndex + 1} of ${queue.length}` : 'Ready'),
      isPlaying,
      positionSec,
      durationSec,
      artworkUri,
    ).catch(() => {});
  }, [artworkOverrides, currentIndex, durationSec, isPlaying, positionSec, queue]);

  const value = useMemo(() => ({
    queue, currentIndex, isPlaying, isLoading, positionSec, durationSec,
    volume, muted, shuffle, repeat, favorites, artworkOverrides, folders, recentFolders, quickFolderPaths, currentFolderPath, permissionGranted,
    sleepTimerEnd, sleepRemainingSec, gaplessEnabled, wheelHapticStrength, visualizerEnabled, visualizerMode, savedPlaylists,
    loadFolders, playFolder, playTrack, playQueueIndex, togglePlay, stop, next, prev, seekTo, setVolume,
    toggleMute, toggleShuffle, cycleRepeat, toggleFavorite, setTrackArtwork, addQuickFolder, removeQuickFolder, setPermissionGranted, setSleepTimer, setGapless, setWheelHapticStrength, setVisualizerEnabled, setVisualizerMode, addTrackToPlaylist,
  }), [queue, currentIndex, isPlaying, isLoading, positionSec, durationSec, volume, muted, shuffle,
       repeat, favorites, artworkOverrides, folders, recentFolders, quickFolderPaths, currentFolderPath, permissionGranted,
       sleepTimerEnd, sleepRemainingSec, gaplessEnabled, wheelHapticStrength, visualizerEnabled, visualizerMode, savedPlaylists,
       loadFolders, playFolder, playTrack, playQueueIndex, togglePlay, stop, next, prev, seekTo, setVolume,
       toggleMute, toggleShuffle, cycleRepeat, toggleFavorite, setTrackArtwork, addQuickFolder, removeQuickFolder, setSleepTimer, setGapless, setWheelHapticStrength, setVisualizerEnabled, setVisualizerMode, addTrackToPlaylist]);

  return <PlayerCtx.Provider value={value}>{children}</PlayerCtx.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error('usePlayer outside PlayerProvider');
  return ctx;
}

export function currentTrack(state: ReturnType<typeof usePlayer>): Track | null {
  if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) return null;
  return state.queue[state.currentIndex];
}
