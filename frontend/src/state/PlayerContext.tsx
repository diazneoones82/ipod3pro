import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Track = {
  id: string;
  uri: string;
  filename: string;
  duration?: number; // seconds
  folder: string; // parent folder path
  folderName: string;
};

export type FolderInfo = {
  path: string; // unique key
  name: string;
  trackCount: number;
  tracks: Track[];
};

type PlayerState = {
  // queue/track
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  isLoading: boolean;
  positionSec: number;
  durationSec: number;
  volume: number; // 0..1
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';
  // folders cache
  folders: FolderInfo[];
  recentFolders: string[]; // paths
  currentFolderPath: string | null;
  // permissions
  permissionGranted: boolean;
};

type PlayerActions = {
  loadFolders: () => Promise<void>;
  playFolder: (folderPath: string, startIndex?: number) => Promise<void>;
  playTrack: (track: Track) => Promise<void>;
  togglePlay: () => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seekTo: (sec: number) => void;
  setVolume: (vol: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setPermissionGranted: (granted: boolean) => void;
};

const PlayerCtx = createContext<(PlayerState & PlayerActions) | null>(null);

const RECENT_KEY = '@chromeamp/recent_folders';
const VOLUME_KEY = '@chromeamp/volume';

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'one' | 'all'>('off');
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);

  // Init audio mode + restore persisted prefs
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
    })();
  }, []);

  // Position polling
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (p) {
        setPositionSec(p.currentTime ?? 0);
        if (p.duration && Number.isFinite(p.duration)) setDurationSec(p.duration);
        setIsPlaying(!!p.playing);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Auto-advance on finish
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const sub = p.addListener('playbackStatusUpdate', (status: any) => {
      if (status?.didJustFinish) {
        handleTrackEnd();
      }
    });
    return () => { sub?.remove?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, queue.length, repeat, shuffle]);

  const persistRecent = useCallback(async (list: string[]) => {
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
  }, []);

  const setupPlayer = useCallback((uri: string) => {
    try { playerRef.current?.remove(); } catch {}
    const p = createAudioPlayer({ uri });
    p.volume = volume;
    playerRef.current = p;
    return p;
  }, [volume]);

  const playTrackAtIndex = useCallback(async (idx: number, list: Track[]) => {
    if (idx < 0 || idx >= list.length) return;
    setIsLoading(true);
    const t = list[idx];
    const p = setupPlayer(t.uri);
    setCurrentIndex(idx);
    setPositionSec(0);
    setDurationSec(t.duration ?? 0);
    try { p.play(); setIsPlaying(true); } catch {}
    setIsLoading(false);
  }, [setupPlayer]);

  const handleTrackEnd = useCallback(() => {
    if (repeat === 'one') {
      playTrackAtIndex(currentIndex, queue);
      return;
    }
    let next = currentIndex + 1;
    if (shuffle && queue.length > 1) {
      next = Math.floor(Math.random() * queue.length);
    }
    if (next >= queue.length) {
      if (repeat === 'all') next = 0;
      else { setIsPlaying(false); return; }
    }
    playTrackAtIndex(next, queue);
  }, [repeat, shuffle, currentIndex, queue, playTrackAtIndex]);

  const loadFolders = useCallback(async () => {
    try {
      // Lazy-load to keep web bundle happy
      const MediaLibrary = await import('expo-media-library');
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) { setPermissionGranted(false); return; }
      setPermissionGranted(true);
      // Get all audio assets — paginate
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
      // Group by folder
      const map = new Map<string, FolderInfo>();
      for (const a of all) {
        const uri: string = a.uri || a.localUri || '';
        const filename: string = a.filename || 'Unknown';
        // Derive folder path from filename / uri path
        // expo-media-library returns content:// URIs on android; use albumId / fallback to "Music"
        const folderPath: string = a.albumId ? `album:${a.albumId}` : 'all';
        const folderName: string = a.albumId ? (a.album || 'Album') : 'All Music';
        const track: Track = {
          id: a.id,
          uri,
          filename,
          duration: a.duration,
          folder: folderPath,
          folderName,
        };
        if (!map.has(folderPath)) {
          map.set(folderPath, { path: folderPath, name: folderName, trackCount: 0, tracks: [] });
        }
        const f = map.get(folderPath)!;
        f.tracks.push(track);
        f.trackCount = f.tracks.length;
      }
      // Resolve album names where missing
      try {
        const albums = await MediaLibrary.getAlbumsAsync();
        for (const al of albums) {
          const key = `album:${al.id}`;
          if (map.has(key)) {
            const f = map.get(key)!;
            f.name = al.title || f.name;
          }
        }
      } catch {}
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

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) { p.pause(); setIsPlaying(false); }
    else { p.play(); setIsPlaying(true); }
  }, []);

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
    if (playerRef.current) playerRef.current.volume = v;
    AsyncStorage.setItem(VOLUME_KEY, String(v)).catch(() => {});
  }, []);

  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);
  const cycleRepeat = useCallback(() => setRepeat((r) => r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'), []);

  const value = useMemo(() => ({
    queue, currentIndex, isPlaying, isLoading, positionSec, durationSec,
    volume, shuffle, repeat, folders, recentFolders, currentFolderPath, permissionGranted,
    loadFolders, playFolder, playTrack, togglePlay, next, prev, seekTo, setVolume,
    toggleShuffle, cycleRepeat, setPermissionGranted,
  }), [queue, currentIndex, isPlaying, isLoading, positionSec, durationSec, volume, shuffle,
       repeat, folders, recentFolders, currentFolderPath, permissionGranted,
       loadFolders, playFolder, playTrack, togglePlay, next, prev, seekTo, setVolume,
       toggleShuffle, cycleRepeat]);

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
