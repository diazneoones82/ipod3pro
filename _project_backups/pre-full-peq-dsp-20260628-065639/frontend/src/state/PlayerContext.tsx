import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setNativeEqSession } from '@/src/native/ShuffleEqualizer';

export type Track = {
  id: string;
  uri: string;
  filename: string;
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
  folders: FolderInfo[];
  recentFolders: string[];
  currentFolderPath: string | null;
  permissionGranted: boolean;
  // new
  sleepTimerEnd: number | null; // ms epoch
  sleepRemainingSec: number | null;
  gaplessEnabled: boolean;
};

type PlayerActions = {
  loadFolders: () => Promise<void>;
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
  setPermissionGranted: (granted: boolean) => void;
  setSleepTimer: (minutes: number | null) => void;
  setGapless: (v: boolean) => void;
};

const PlayerCtx = createContext<(PlayerState & PlayerActions) | null>(null);

const RECENT_KEY = '@shuffleimusic/recent_folders';
const VOLUME_KEY = '@shuffleimusic/volume';
const GAPLESS_KEY = '@shuffleimusic/gapless';
const FAVORITES_KEY = '@shuffleimusic/favorites';

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
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [sleepTimerEnd, setSleepTimerEnd] = useState<number | null>(null);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
  const [gaplessEnabled, setGaplessEnabled] = useState(true);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    }).catch(() => {});
    (async () => {
      const v = await AsyncStorage.getItem(VOLUME_KEY);
      if (v != null) setVolumeState(parseFloat(v));
      const r = await AsyncStorage.getItem(RECENT_KEY);
      if (r) try { setRecentFolders(JSON.parse(r)); } catch {}
      const g = await AsyncStorage.getItem(GAPLESS_KEY);
      if (g != null) setGaplessEnabled(g === 'true');
      const fav = await AsyncStorage.getItem(FAVORITES_KEY);
      if (fav) try { setFavorites(JSON.parse(fav)); } catch {}
    })();
  }, []);

  // Position polling + sleep timer countdown + gapless preload trigger
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (p) {
        setPositionSec(p.currentTime ?? 0);
        if (p.duration && Number.isFinite(p.duration)) setDurationSec(p.duration);
        setIsPlaying(!!p.playing);
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
            const np = createAudioPlayer({ uri: nextTrack.uri });
            np.volume = 0;
            nextPlayerRef.current = np;
            nextPreloadedFor.current = nextTrack.id;
          } catch {}
        }
      }
    }, 500);
    return () => clearInterval(id);
  }, [sleepTimerEnd, sleepRemainingSec, gaplessEnabled, durationSec, currentIndex, queue, repeat]);

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
    const p = createAudioPlayer({ uri });
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
      syncPlayerEqSession(p);
      setTimeout(() => syncPlayerEqSession(p), 250);
      setIsPlaying(true);
    } catch {}
    setIsLoading(false);
  }, [clearPreload, disposePlayer, setupPlayer, gaplessEnabled, muted, volume]);

  const handleTrackEnd = useCallback(() => {
    if (repeat === 'one') {
      playTrackAtIndex(currentIndex, queue);
      return;
    }
    let n = currentIndex + 1;
    if (shuffle && queue.length > 1) n = Math.floor(Math.random() * queue.length);
    if (n >= queue.length) {
      if (repeat === 'all') n = 0;
      else { setIsPlaying(false); return; }
    }
    playTrackAtIndex(n, queue);
  }, [repeat, shuffle, currentIndex, queue, playTrackAtIndex]);

  const loadFolders = useCallback(async () => {
    try {
      const MediaLibrary = await import('expo-media-library');
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) { setPermissionGranted(false); return; }
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
      after = undefined;
      for (let i = 0; i < 12; i++) {
        const page: any = await MediaLibrary.getAssetsAsync({
          mediaType: MediaLibrary.MediaType.photo,
          first: 200,
          after,
          sortBy: [MediaLibrary.SortBy.creationTime],
        });
        for (const img of page.assets || []) {
          const uri: string = img.uri || img.localUri || '';
          const filename: string = img.filename || '';
          if (!uri || !filename || !/\.(png|jpe?g|webp)$/i.test(filename)) continue;
          const { folderPath } = parseFolder(uri);
          imageByExactName.set(coverKey(folderPath, filename), uri);
          if (/^(cover|folder|album|artwork|front)$/i.test(stripExt(filename))) {
            imageByFolderCover.set(folderPath, uri);
          }
        }
        if (!page.hasNextPage) break;
        after = page.endCursor;
      }
      const map = new Map<string, FolderInfo>();
      for (const a of all) {
        const uri: string = a.uri || a.localUri || '';
        const filename: string = a.filename || 'Unknown';
        let { folderPath, folderName } = parseFolder(uri);
        // Fallback to album grouping if we can't parse the path
        if (folderPath === 'unknown' && a.albumId) {
          folderPath = `album:${a.albumId}`;
          folderName = a.album || 'Album';
        }
        const artworkUri = imageByExactName.get(coverKey(folderPath, filename)) ?? imageByFolderCover.get(folderPath);
        const track: Track = { id: a.id, uri, filename, duration: a.duration, folder: folderPath, folderName, artworkUri };
        if (!map.has(folderPath)) {
          map.set(folderPath, { path: folderPath, name: folderName, trackCount: 0, tracks: [] });
        }
        const f = map.get(folderPath)!;
        f.tracks.push(track);
        f.trackCount = f.tracks.length;
      }
      const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
      setFolders(list);
    } catch (e) {
      console.warn('loadFolders error', e);
    }
  }, []);

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
    if (p.playing) { p.pause(); setIsPlaying(false); }
    else { p.play(); setIsPlaying(true); }
  }, []);

  const stop = useCallback(() => {
    activePlayerIdRef.current += 1;
    clearPreload();
    const p = playerRef.current;
    if (!p) return;
    try { p.pause(); p.seekTo(0); } catch {}
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

  const value = useMemo(() => ({
    queue, currentIndex, isPlaying, isLoading, positionSec, durationSec,
    volume, muted, shuffle, repeat, favorites, folders, recentFolders, currentFolderPath, permissionGranted,
    sleepTimerEnd, sleepRemainingSec, gaplessEnabled,
    loadFolders, playFolder, playTrack, playQueueIndex, togglePlay, stop, next, prev, seekTo, setVolume,
    toggleMute, toggleShuffle, cycleRepeat, toggleFavorite, setPermissionGranted, setSleepTimer, setGapless,
  }), [queue, currentIndex, isPlaying, isLoading, positionSec, durationSec, volume, muted, shuffle,
       repeat, favorites, folders, recentFolders, currentFolderPath, permissionGranted,
       sleepTimerEnd, sleepRemainingSec, gaplessEnabled,
       loadFolders, playFolder, playTrack, playQueueIndex, togglePlay, stop, next, prev, seekTo, setVolume,
       toggleMute, toggleShuffle, cycleRepeat, toggleFavorite, setSleepTimer, setGapless]);

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
