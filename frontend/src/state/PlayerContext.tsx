import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addNativeMediaActionListener, appendNativeDiagnosticsLog, consumePendingNativeMediaAction,
  exportNativeStartupLogcat, getNativeAudioMetadata, getNativeBackgroundDiagnostics,
  nativeInitPlayer, nativeLoadQueue, nativeTogglePlay, nativeNext, nativePrevious,
  nativeSeekTo, nativeStopPlayback, nativeSetRepeatMode, nativeSetShuffleEnabled,
  nativeSetVolume, nativePause, nativePlay, nativeSetGaplessEnabled,
  addNativePlayerStateListener, addNativeTrackChangedListener, addNativePlayerErrorListener, addNativeQueueEndedListener,
  addNativeCastStateListener, nativeIsCastAvailable, nativeCastLoadQueue, nativeCastPlay, nativeCastPause, nativeCastTogglePlay,
} from '@/src/native/ShuffleEqualizer';
import type { NativeCastState } from '@/src/native/ShuffleEqualizer';

export type Track = {
  id: string;
  uri: string;
  filename: string;
  title?: string;
  artist?: string;
  contributingArtist?: string;
  album?: string;
  albumId?: string;
  duration?: number;
  folder: string;
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
  sleepTimerEnd: number | null;
  sleepRemainingSec: number | null;
  gaplessEnabled: boolean;
  wheelHapticStrength: number;
  visualizerEnabled: boolean;
  visualizerMode: VisualizerMode;
  savedPlaylists: SavedPlaylist[];
  castConnected: boolean;
  castDeviceName: string;
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
  setSavedPlaylists: (playlists: SavedPlaylist[]) => void;
  moveInQueue: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  castTogglePlay: () => void;
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

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const pausedForCallRef = useRef(false);
  const restoredLastStateRef = useRef(false);
  const autoLoadedLibraryRef = useRef(false);
  const nativeInitializedRef = useRef(false);
  const lastNativeStateRef = useRef({ positionMs: 0, durationMs: 0, isPlaying: false, currentIndex: -1, lastUpdateMs: 0 });
  const queueRef = useRef<Track[]>([]);
  const currentIndexRef = useRef(-1);

  const [queue, setQueue] = useState<Track[]>([]);
  queueRef.current = queue;
  const [currentIndex, setCurrentIndex] = useState(-1);
  currentIndexRef.current = currentIndex;
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
  const [savedPlaylists, setSavedPlaylistsState] = useState<SavedPlaylist[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [castConnected, setCastConnected] = useState(false);
  const [castDeviceName, setCastDeviceName] = useState('');

  const repeatModeToNative = (mode: 'off' | 'one' | 'all'): number =>
    mode === 'off' ? 0 : mode === 'one' ? 1 : 2;

  const repeatModeFromNative = (mode: number): 'off' | 'one' | 'all' =>
    mode === 1 ? 'one' : mode === 2 ? 'all' : 'off';

  // Init native player + load prefs
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!nativeInitializedRef.current) {
      nativeInitializedRef.current = true;
      nativeInitPlayer().catch(() => {});
    }
  }, []);

  useEffect(() => {
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
      if (playlists) try { setSavedPlaylistsState(JSON.parse(playlists)); } catch {}
    })().finally(() => {
      setStorageReady(true);
      appendNativeDiagnosticsLog('app_started storage_ready=true').catch(() => {});
      exportNativeStartupLogcat().catch(() => {});
      getNativeBackgroundDiagnostics()
        .then((diag) => appendNativeDiagnosticsLog(`background_diagnostics=${JSON.stringify(diag)}`))
        .catch(() => {});
    });
  }, []);

  // Position tracking: smooth local interpolation based on native state events
  useEffect(() => {
    const id = setInterval(() => {
      const ns = lastNativeStateRef.current;
      if (ns.durationMs > 0) {
        if (ns.isPlaying) {
          const elapsed = Date.now() - ns.lastUpdateMs;
          const pos = Math.min(ns.positionMs + elapsed, ns.durationMs);
          setPositionSec(pos / 1000);
        } else {
          setPositionSec(ns.positionMs / 1000);
        }
        setDurationSec(ns.durationMs / 1000);
      }
      if (sleepTimerEnd != null) {
        const remaining = Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 1000));
        setSleepRemainingSec(remaining);
        if (remaining <= 0) {
          nativePause().catch(() => {});
          appendNativeDiagnosticsLog('sleep_timer_pause').catch(() => {});
          setIsPlaying(false);
          setSleepTimerEnd(null);
          setSleepRemainingSec(null);
        }
      } else if (sleepRemainingSec != null) {
        setSleepRemainingSec(null);
      }
    }, 500);
    return () => clearInterval(id);
  }, [sleepTimerEnd, sleepRemainingSec]);

  // Native event listeners
  useEffect(() => {
    const stateSub = addNativePlayerStateListener((state) => {
      const now = Date.now();
      lastNativeStateRef.current = {
        positionMs: state.positionMs,
        durationMs: state.durationMs,
        isPlaying: state.isPlaying,
        currentIndex: state.currentIndex,
        lastUpdateMs: now,
      };
      setIsPlaying(state.isPlaying);
      setDurationSec(state.durationMs / 1000);
      setPositionSec(state.positionMs / 1000);
      setCurrentIndex(state.currentIndex);
      setShuffle(state.shuffleEnabled);
      setRepeat(repeatModeFromNative(state.repeatMode));
      setIsLoading(false);
    });

    const trackSub = addNativeTrackChangedListener((data: any) => {
      setCurrentIndex(data.index);
      const trk = queueRef.current[data.index];
      if (trk?.duration) {
        setPositionSec(0);
        setDurationSec(trk.duration);
        lastNativeStateRef.current = { ...lastNativeStateRef.current, positionMs: 0, durationMs: trk.duration * 1000, currentIndex: data.index, lastUpdateMs: Date.now() };
      }
      appendNativeDiagnosticsLog(`native_track_changed index=${data.index} id=${data.trackId} duration=${trk?.duration}`).catch(() => {});
    });

    const errorSub = addNativePlayerErrorListener((error) => {
      appendNativeDiagnosticsLog(`native_player_error ${error.message}`).catch(() => {});
    });

    const queueEndSub = addNativeQueueEndedListener(() => {
      appendNativeDiagnosticsLog('native_queue_ended').catch(() => {});
      setIsPlaying(false);
      setPositionSec(0);
      lastNativeStateRef.current = { ...lastNativeStateRef.current, positionMs: 0, isPlaying: false, lastUpdateMs: Date.now() };
    });

    const castSub = addNativeCastStateListener((evt: NativeCastState) => {
      if (evt.state === 'connected') {
        setCastConnected(true);
        setCastDeviceName(evt.deviceName ?? '');
        appendNativeDiagnosticsLog(`cast_connected device=${evt.deviceName}`).catch(() => {});
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        if (q.length > 0 && idx >= 0) {
          nativeCastLoadQueue(q, idx).catch(() => {});
        }
      } else if (evt.state === 'disconnected') {
        setCastConnected(false);
        setCastDeviceName('');
        appendNativeDiagnosticsLog('cast_disconnected').catch(() => {});
        if (queueRef.current.length > 0) {
          nativePlay().catch(() => {});
        }
      }
    });

    nativeIsCastAvailable().then((avail) => {
      if (avail) appendNativeDiagnosticsLog('cast_available=true').catch(() => {});
    }).catch(() => {});

    return () => {
      stateSub.remove();
      trackSub.remove();
      errorSub.remove();
      queueEndSub.remove();
      castSub.remove();
    };
  }, []);

  const persistRecent = useCallback(async (list: string[]) => {
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
  }, []);

  const persistQuickFolders = useCallback(async (list: string[]) => {
    await AsyncStorage.setItem(QUICK_FOLDERS_KEY, JSON.stringify(list.slice(0, 20)));
  }, []);

  const loadQueueToNative = useCallback(async (list: Track[], startIndex: number) => {
    setQueue(list);
    setIsLoading(true);
    setCurrentIndex(startIndex);
    const track = list[startIndex];
    if (track) {
      setPositionSec(0);
      setDurationSec(track.duration ?? 0);
      lastNativeStateRef.current = { positionMs: 0, durationMs: (track.duration ?? 0) * 1000, isPlaying: false, currentIndex: startIndex, lastUpdateMs: Date.now() };
    }
    await nativeLoadQueue(list, startIndex);
    if (castConnected) {
      nativeCastLoadQueue(list, startIndex).catch(() => {});
    }
  }, [castConnected]);

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
              const seek = Math.max(0, last.positionSec || 0);
              await loadQueueToNative(folder.tracks, idx);
              if (seek > 0) await nativeSeekTo(seek * 1000);
              await nativePlay();
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
      return { folderCount: 0, trackCount: 0 };
    }
  }, [artworkOverrides, loadQueueToNative]);

  useEffect(() => {
    if (!storageReady) return;
    if (autoLoadedLibraryRef.current) return;
    autoLoadedLibraryRef.current = true;
    loadFolders().catch(() => {});
  }, [loadFolders, storageReady]);

  const playFolder = useCallback(async (folderPath: string, startIndex = 0) => {
    const f = folders.find((x) => x.path === folderPath);
    if (!f || f.tracks.length === 0) return;
    setCurrentFolderPath(folderPath);
    const recent = [folderPath, ...recentFolders.filter((p) => p !== folderPath)].slice(0, 10);
    setRecentFolders(recent);
    persistRecent(recent);
    await loadQueueToNative(f.tracks, startIndex);
  }, [folders, recentFolders, persistRecent, loadQueueToNative]);

  const playTrack = useCallback(async (track: Track) => {
    const f = folders.find((x) => x.path === track.folder);
    const list = f ? f.tracks : [track];
    setCurrentFolderPath(track.folder);
    const idx = list.findIndex((t) => t.id === track.id);
    await loadQueueToNative(list, idx >= 0 ? idx : 0);
  }, [folders, loadQueueToNative]);

  const playQueueIndex = useCallback(async (idx: number) => {
    if (idx < 0 || idx >= queue.length) return;
    await nativeSeekTo(idx);
    // Force reload by seeking to the start of the target track
    const targetId = queue[idx]?.id;
    if (targetId) {
      await loadQueueToNative(queue, idx);
    }
  }, [queue, loadQueueToNative]);

  const togglePlay = useCallback(() => {
    if (castConnected) {
      nativeCastTogglePlay().catch(() => {});
    } else {
      nativeTogglePlay().catch(() => {});
    }
    setIsPlaying((p) => !p);
  }, [castConnected]);

  const stop = useCallback(() => {
    nativeStopPlayback().catch(() => {});
    setIsPlaying(false);
    setPositionSec(0);
  }, []);

  const next = useCallback(async () => {
    await nativeNext();
  }, []);

  const prev = useCallback(async () => {
    if (positionSec > 3) {
      await nativeSeekTo(0);
    } else {
      await nativePrevious();
    }
  }, [positionSec]);

  const seekTo = useCallback((sec: number) => {
    nativeSeekTo(Math.max(0, sec) * 1000).catch(() => {});
    setPositionSec(sec);
    lastNativeStateRef.current = { ...lastNativeStateRef.current, positionMs: sec * 1000, lastUpdateMs: Date.now() };
  }, []);

  const setVolume = useCallback((vol: number) => {
    const v = Math.max(0, Math.min(1, vol));
    setVolumeState(v);
    nativeSetVolume(v).catch(() => {});
    AsyncStorage.setItem(VOLUME_KEY, String(v)).catch(() => {});
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const nextMuted = !m;
      nativeSetVolume(nextMuted ? 0 : volume).catch(() => {});
      return nextMuted;
    });
  }, [volume]);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => {
      const next = !s;
      nativeSetShuffleEnabled(next).catch(() => {});
      return next;
    });
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => {
      const next = r === 'off' ? 'all' : r === 'all' ? 'one' : 'off';
      nativeSetRepeatMode(repeatModeToNative(next)).catch(() => {});
      return next;
    });
  }, []);

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
    setGaplessEnabled(v);
    AsyncStorage.setItem(GAPLESS_KEY, String(v)).catch(() => {});
    nativeSetGaplessEnabled(v).catch(() => {});
  }, []);

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

  const castTogglePlay = useCallback(() => {
    if (castConnected) {
      nativeCastTogglePlay().catch(() => {});
    } else {
      nativeTogglePlay().catch(() => {});
    }
  }, [castConnected]);

  const moveInQueue = useCallback((fromIndex: number, toIndex: number) => {
    setQueue((q) => {
      if (fromIndex < 0 || fromIndex >= q.length || toIndex < 0 || toIndex >= q.length) return q;
      const next = [...q];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setQueue((q) => {
      if (index < 0 || index >= q.length) return q;
      const next = q.filter((_, i) => i !== index);
      if (index < currentIndexRef.current) {
        currentIndexRef.current -= 1;
        setCurrentIndex(currentIndexRef.current);
      }
      return next;
    });
  }, []);

  const setSavedPlaylists = useCallback((playlists: SavedPlaylist[]) => {
    setSavedPlaylistsState(playlists);
    AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists)).catch(() => {});
  }, []);

  const addTrackToPlaylist = useCallback(async (trackId: string, playlistId?: string, playlistName?: string) => {
    if (!trackId) return false;
    setSavedPlaylistsState((list) => {
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

  // Persist last state
  useEffect(() => {
    const track = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
    if (!track && !currentFolderPath) return;
    AsyncStorage.setItem(LAST_STATE_KEY, JSON.stringify({
      folderPath: currentFolderPath || track?.folder || null,
      trackId: track?.id || null,
      positionSec: Math.max(0, positionSec || 0),
    } satisfies LastPlayerState)).catch(() => {});
  }, [currentFolderPath, currentIndex, positionSec, queue]);

  // Handle media actions from notification/widgets
  const handleMediaAction = useCallback((action: string | null | undefined) => {
    if (action) appendNativeDiagnosticsLog(`js_media_action=${action}`).catch(() => {});
    if (action === 'toggle') togglePlay();
    else if (action === 'play') nativePlay().catch(() => {});
    else if (action === 'pause') nativePause().catch(() => {});
    else if (action === 'phone_pause') {
      nativePause().catch(() => {});
      pausedForCallRef.current = true;
    } else if (action === 'phone_resume') {
      if (pausedForCallRef.current) {
        pausedForCallRef.current = false;
        nativePlay().catch(() => {});
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

  const value = useMemo(() => ({
    queue, currentIndex, isPlaying, isLoading, positionSec, durationSec,
    volume, muted, shuffle, repeat, favorites, artworkOverrides, folders, recentFolders, quickFolderPaths, currentFolderPath, permissionGranted,
    sleepTimerEnd, sleepRemainingSec, gaplessEnabled, wheelHapticStrength, visualizerEnabled, visualizerMode, savedPlaylists,
    castConnected, castDeviceName,
    loadFolders, playFolder, playTrack, playQueueIndex, togglePlay, stop, next, prev, seekTo, setVolume,
    toggleMute, toggleShuffle, cycleRepeat, toggleFavorite, setTrackArtwork, addQuickFolder, removeQuickFolder, setPermissionGranted, setSleepTimer, setGapless, setWheelHapticStrength, setVisualizerEnabled, setVisualizerMode, setSavedPlaylists, addTrackToPlaylist, moveInQueue, removeFromQueue, castTogglePlay,
  }), [queue, currentIndex, isPlaying, isLoading, positionSec, durationSec, volume, muted, shuffle,
        repeat, favorites, artworkOverrides, folders, recentFolders, quickFolderPaths, currentFolderPath, permissionGranted,
        sleepTimerEnd, sleepRemainingSec, gaplessEnabled, wheelHapticStrength, visualizerEnabled, visualizerMode, savedPlaylists,
        castConnected, castDeviceName,
        loadFolders, playFolder, playTrack, playQueueIndex, togglePlay, stop, next, prev, seekTo, setVolume,
        toggleMute, toggleShuffle, cycleRepeat, toggleFavorite, setTrackArtwork, addQuickFolder, removeQuickFolder, setSleepTimer, setGapless, setWheelHapticStrength, setVisualizerEnabled, setVisualizerMode, setSavedPlaylists, addTrackToPlaylist, moveInQueue, removeFromQueue, castTogglePlay]);

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
