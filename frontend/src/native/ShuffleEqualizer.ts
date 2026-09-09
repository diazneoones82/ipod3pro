import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import type { EQBand } from '@/src/utils/eq-parser';

export type NativeAudioTags = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: string;
  trackNumber?: string;
  composer?: string;
  lyrics?: string;
  artworkMime?: string;
};

export type NativeEqStatus = {
  status: 'idle' | 'active' | 'bypassed' | 'unavailable';
  message: string;
  lastAppliedAt: number;
  bandCount: number;
  processorCreatedAt?: number;
  lastProcessedAt?: number;
  processedBuffers?: number;
  lastSampleRate?: number;
  lastChannelCount?: number;
  lastActiveBandCount?: number;
};

export type NativeAudioEffects = {
  enabled: boolean;
  preamp: number;
  bands: EQBand[];
  loudnessDb?: number;
  stereoWidth?: number;
  bassBoostDb?: number;
  virtualizerStrength?: number;
  reverbPreset?: number;
};

type NativeShuffleEqualizer = {
  applyPeq(enabled: boolean, preamp: number, bands: EQBand[]): Promise<NativeEqStatus>;
  applyAudioEffects(
    enabled: boolean,
    preamp: number,
    bands: EQBand[],
    loudnessDb: number,
    stereoWidth: number,
    bassBoostDb: number,
    virtualizerStrength: number,
    reverbPreset: number,
  ): Promise<NativeEqStatus>;
  getStatus(): Promise<NativeEqStatus>;
  release(): Promise<NativeEqStatus>;
  getAudioMetadata?(assetIds: string[]): Promise<Record<string, NativeAudioMetadata>>;
  updateMediaStatus?(title: string, subtitle: string, isPlaying: boolean, positionSec: number, durationSec: number, artworkUri?: string): Promise<{ ok: boolean }>;
  consumePendingMediaAction?(): Promise<string | null>;
  appendDiagnosticsLog?(line: string): Promise<boolean>;
  exportStartupLogcat?(): Promise<boolean>;
  getBackgroundDiagnostics?(): Promise<Record<string, unknown>>;
  readAudioTags?(path: string): Promise<NativeAudioTags>;
  writeAudioTags?(path: string, tags: Record<string, string>): Promise<boolean>;
};

const moduleRef = NativeModules.ShuffleEqualizer as NativeShuffleEqualizer | undefined;
const playerRef = NativeModules.ShufflePlayer as NativeShufflePlayer | undefined;

export type NativeAudioMetadata = {
  title?: string;
  artist?: string;
  contributingArtist?: string;
  album?: string;
  albumId?: string;
  durationMs?: number;
};

let lastConfig: NativeAudioEffects = {
  enabled: false,
  preamp: 0,
  bands: [],
  loudnessDb: 0,
  stereoWidth: 1.0,
  bassBoostDb: 0,
  virtualizerStrength: 0,
  reverbPreset: -1,
};

const fallbackStatus: NativeEqStatus = {
  status: 'unavailable',
  message: 'Native PEQ bridge unavailable',
  lastAppliedAt: 0,
  bandCount: 0,
};

export async function syncNativeEq(enabled: boolean, preamp: number, bands: EQBand[]): Promise<NativeEqStatus> {
  return syncNativeAudioEffects({ ...lastConfig, enabled, preamp, bands });
}

export async function syncNativeAudioEffects(effects: NativeAudioEffects): Promise<NativeEqStatus> {
  lastConfig = { ...effects };
  if (Platform.OS !== 'android') return { ...fallbackStatus, message: 'Native PEQ DSP is Android-only' };
  if (!moduleRef) return fallbackStatus;
  try {
    if (moduleRef.applyAudioEffects) {
      return await moduleRef.applyAudioEffects(
        effects.enabled,
        effects.preamp,
        effects.bands,
        effects.loudnessDb ?? 0,
        effects.stereoWidth ?? 1.0,
        effects.bassBoostDb ?? 0,
        effects.virtualizerStrength ?? 0,
        effects.reverbPreset ?? -1
      );
    }
    return await moduleRef.applyPeq(effects.enabled, effects.preamp, effects.bands);
  } catch (e) {
    return { ...fallbackStatus, message: e instanceof Error ? e.message : 'Native effects sync failed' };
  }
}

export async function getNativeEqStatus(): Promise<NativeEqStatus> {
  if (Platform.OS !== 'android') return { ...fallbackStatus, message: 'Native PEQ DSP is Android-only' };
  if (!moduleRef) return fallbackStatus;
  try {
    return await moduleRef.getStatus();
  } catch (e) {
    return { ...fallbackStatus, message: e instanceof Error ? e.message : 'Native PEQ status failed' };
  }
}

export async function setNativeEqSession(sessionId: number | undefined | null) {
  if (Platform.OS !== 'android') return fallbackStatus;
  return syncNativeEq(lastConfig.enabled, lastConfig.preamp, lastConfig.bands);
}

export async function getNativeAudioMetadata(assetIds: string[]): Promise<Record<string, NativeAudioMetadata>> {
  if (Platform.OS !== 'android' || !moduleRef?.getAudioMetadata || assetIds.length === 0) return {};
  try {
    return await moduleRef.getAudioMetadata(assetIds);
  } catch {
    return {};
  }
}

export async function updateNativeMediaStatus(title: string, subtitle: string, isPlaying: boolean, positionSec: number, durationSec: number, artworkUri?: string) {
  if (Platform.OS !== 'android' || !moduleRef?.updateMediaStatus) return false;
  try {
    await moduleRef.updateMediaStatus(title, subtitle, isPlaying, positionSec, durationSec, artworkUri);
    return true;
  } catch {
    return false;
  }
}

export function addNativeMediaActionListener(listener: (action: string) => void) {
  if (Platform.OS !== 'android') return { remove() {} };
  return DeviceEventEmitter.addListener('ShuffleMediaAction', listener);
}

export async function consumePendingNativeMediaAction() {
  if (Platform.OS !== 'android' || !moduleRef?.consumePendingMediaAction) return null;
  try {
    return await moduleRef.consumePendingMediaAction();
  } catch {
    return null;
  }
}

export async function appendNativeDiagnosticsLog(line: string) {
  if (Platform.OS !== 'android' || !moduleRef?.appendDiagnosticsLog) return false;
  try {
    return await moduleRef.appendDiagnosticsLog(line);
  } catch {
    return false;
  }
}

export async function exportNativeStartupLogcat() {
  if (Platform.OS !== 'android' || !moduleRef?.exportStartupLogcat) return false;
  try {
    return await moduleRef.exportStartupLogcat();
  } catch {
    return false;
  }
}

// ---- Native Player Bridge ----

export type NativePlayerState = {
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  currentIndex: number;
  repeatMode: number;
  shuffleEnabled: boolean;
  queueSize: number;
};

type NativeShufflePlayer = {
  initPlayer(): Promise<boolean>;
  loadQueue(tracks: ReadableTrack[], startIndex: number): Promise<boolean>;
  play(): Promise<boolean>;
  pause(): Promise<boolean>;
  togglePlay(): Promise<boolean>;
  next(): Promise<boolean>;
  previous(): Promise<boolean>;
  seekToIndex(index: number): Promise<boolean>;
  seekTo(positionMs: number): Promise<boolean>;
  stopPlayback(): Promise<boolean>;
  setRepeatMode(repeatMode: number): Promise<boolean>;
  setGaplessEnabled(enabled: boolean): Promise<boolean>;
  setShuffleEnabled(enabled: boolean): Promise<boolean>;
  setVolume(volume: number): Promise<boolean>;
  isCastAvailable(): Promise<boolean>;
  castLoadQueue(tracks: ReadableTrack[], startIndex: number): Promise<boolean>;
  castPlay(): Promise<boolean>;
  castPause(): Promise<boolean>;
  castTogglePlay(): Promise<boolean>;
};

type ReadableTrack = {
  id: string;
  uri: string;
  filename?: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  artworkUri?: string;
};

function playerAvailable() {
  return Platform.OS === 'android' && playerRef != null;
}

export async function nativeInitPlayer() {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.initPlayer()); } catch { return false; }
}

export async function nativeLoadQueue(tracks: ReadableTrack[], startIndex: number) {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.loadQueue(tracks, startIndex)); } catch { return false; }
}

export async function nativePlay() {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.play()); } catch { return false; }
}

export async function nativePause() {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.pause()); } catch { return false; }
}

export async function nativeTogglePlay() {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.togglePlay()); } catch { return false; }
}

export async function nativeNext() {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.next()); } catch { return false; }
}

export async function nativePrevious() {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.previous()); } catch { return false; }
}

export async function nativeSeekToIndex(index: number) {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.seekToIndex(index)); } catch { return false; }
}

export async function nativeSeekTo(positionMs: number) {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.seekTo(positionMs)); } catch { return false; }
}

export async function nativeStopPlayback() {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.stopPlayback()); } catch { return false; }
}

export async function nativeSetRepeatMode(mode: number) {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.setRepeatMode(mode)); } catch { return false; }
}

export async function nativeSetGaplessEnabled(enabled: boolean) {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.setGaplessEnabled(enabled)); } catch { return false; }
}

export async function nativeSetShuffleEnabled(enabled: boolean) {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.setShuffleEnabled(enabled)); } catch { return false; }
}

export async function nativeSetVolume(volume: number) {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.setVolume(volume)); } catch { return false; }
}

// ── Cast bridge ─────────────────────────────────────────────────────────

export type NativeCastState = {
  state: 'connected' | 'disconnected' | 'media_loaded';
  deviceName?: string;
};

export async function nativeIsCastAvailable() {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.isCastAvailable()); } catch { return false; }
}

export async function nativeCastLoadQueue(tracks: ReadableTrack[], startIndex: number) {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.castLoadQueue(tracks, startIndex)); } catch { return false; }
}

export async function nativeCastPlay() {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.castPlay()); } catch { return false; }
}

export async function nativeCastPause() {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.castPause()); } catch { return false; }
}

export async function nativeCastTogglePlay() {
  if (!playerAvailable()) return false;
  try { return !!(await playerRef!.castTogglePlay()); } catch { return false; }
}

export function addNativeCastStateListener(listener: (state: NativeCastState) => void) {
  if (Platform.OS !== 'android') return { remove() {} };
  return DeviceEventEmitter.addListener('ShuffleCastState', listener);
}

export function addNativePlayerStateListener(listener: (state: NativePlayerState) => void) {
  if (Platform.OS !== 'android') return { remove() {} };
  return DeviceEventEmitter.addListener('ShufflePlaybackState', listener);
}

export function addNativeTrackChangedListener(listener: (data: any) => void) {
  if (Platform.OS !== 'android') return { remove() {} };
  return DeviceEventEmitter.addListener('ShuffleTrackChanged', listener);
}

export function addNativePlayerErrorListener(listener: (error: { message: string }) => void) {
  if (Platform.OS !== 'android') return { remove() {} };
  return DeviceEventEmitter.addListener('ShufflePlaybackError', listener);
}

export function addNativeQueueEndedListener(listener: () => void) {
  if (Platform.OS !== 'android') return { remove() {} };
  return DeviceEventEmitter.addListener('ShuffleQueueEnded', listener);
}

export async function getNativeAudioSessionId(): Promise<number> {
  // The native service exposes the audio session ID via a static property
  // called from the module side. For simplicity, we just return 0 (the native
  // EQ will work without session ID if the player owns the audio stream).
  return 0;
}

export async function readNativeAudioTags(path: string): Promise<NativeAudioTags | null> {
  if (Platform.OS !== 'android' || !moduleRef?.readAudioTags) return null;
  try {
    return await moduleRef.readAudioTags(path);
  } catch {
    return null;
  }
}

export async function writeNativeAudioTags(path: string, tags: Record<string, string>): Promise<boolean> {
  if (Platform.OS !== 'android' || !moduleRef?.writeAudioTags) return false;
  try {
    await moduleRef.writeAudioTags(path, tags);
    return true;
  } catch {
    return false;
  }
}

export async function getNativeBackgroundDiagnostics() {
  if (Platform.OS !== 'android' || !moduleRef?.getBackgroundDiagnostics) return {};
  try {
    return await moduleRef.getBackgroundDiagnostics();
  } catch {
    return {};
  }
}
