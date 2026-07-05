import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import type { EQBand } from '@/src/utils/eq-parser';

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

type NativeShuffleEqualizer = {
  applyPeq(enabled: boolean, preamp: number, bands: EQBand[]): Promise<NativeEqStatus>;
  getStatus(): Promise<NativeEqStatus>;
  release(): Promise<NativeEqStatus>;
  getAudioMetadata?(assetIds: string[]): Promise<Record<string, NativeAudioMetadata>>;
  updateMediaStatus?(title: string, subtitle: string, isPlaying: boolean, positionSec: number, durationSec: number, artworkUri?: string): Promise<{ ok: boolean }>;
  consumePendingMediaAction?(): Promise<string | null>;
  appendDiagnosticsLog?(line: string): Promise<boolean>;
  exportStartupLogcat?(): Promise<boolean>;
  getBackgroundDiagnostics?(): Promise<Record<string, unknown>>;
};

const moduleRef = NativeModules.ShuffleEqualizer as NativeShuffleEqualizer | undefined;

export type NativeAudioMetadata = {
  title?: string;
  artist?: string;
  contributingArtist?: string;
  album?: string;
  albumId?: string;
  durationMs?: number;
};

let lastConfig: { enabled: boolean; preamp: number; bands: EQBand[] } = {
  enabled: false,
  preamp: 0,
  bands: [],
};

const fallbackStatus: NativeEqStatus = {
  status: 'unavailable',
  message: 'Native PEQ bridge unavailable',
  lastAppliedAt: 0,
  bandCount: 0,
};

export async function syncNativeEq(enabled: boolean, preamp: number, bands: EQBand[]): Promise<NativeEqStatus> {
  lastConfig = { enabled, preamp, bands };
  if (Platform.OS !== 'android') return { ...fallbackStatus, message: 'Native PEQ DSP is Android-only' };
  if (!moduleRef) return fallbackStatus;
  try {
    return await moduleRef.applyPeq(enabled, preamp, bands);
  } catch (e) {
    return { ...fallbackStatus, message: e instanceof Error ? e.message : 'Native PEQ sync failed' };
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

export async function getNativeBackgroundDiagnostics() {
  if (Platform.OS !== 'android' || !moduleRef?.getBackgroundDiagnostics) return {};
  try {
    return await moduleRef.getBackgroundDiagnostics();
  } catch {
    return {};
  }
}
