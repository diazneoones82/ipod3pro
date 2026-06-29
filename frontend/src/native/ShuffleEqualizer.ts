import { NativeModules, Platform } from 'react-native';
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
};

const moduleRef = NativeModules.ShuffleEqualizer as NativeShuffleEqualizer | undefined;

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
