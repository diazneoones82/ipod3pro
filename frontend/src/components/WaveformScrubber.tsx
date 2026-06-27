import React, { useMemo, useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { COLORS } from '@/src/theme/tokens';

type Props = {
  // 0..1
  progress: number;
  duration: number;
  // seed for deterministic waveform (e.g. track id)
  seed: string;
  onSeek: (sec: number) => void;
  testID?: string;
};

const BAR_COUNT = 56;

// Simple deterministic PRNG from string seed
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function WaveformScrubber({ progress, duration, seed, onSeek, testID }: Props) {
  const [width, setWidth] = useState(0);
  const widthSv = useSharedValue(0);

  const bars = useMemo(() => {
    const rng = mulberry32(hashStr(seed || 'empty') || 1);
    const arr: number[] = [];
    // generate a smooth envelope using sine + noise
    for (let i = 0; i < BAR_COUNT; i++) {
      const t = i / (BAR_COUNT - 1);
      const env = 0.55 + 0.4 * Math.sin(t * Math.PI); // arch shape
      const noise = 0.35 + rng() * 0.65;
      arr.push(Math.max(0.18, Math.min(1, env * noise)));
    }
    return arr;
  }, [seed]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth(w);
    widthSv.value = w;
  };

  const seekToRatio = (r: number) => {
    const clamped = Math.max(0, Math.min(1, r));
    if (duration > 0) {
      Haptics.selectionAsync().catch(() => {});
      onSeek(clamped * duration);
    }
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      const w = widthSv.value || 1;
      const r = e.x / w;
      runOnJS(seekToRatio)(r);
    })
    .onBegin((e) => {
      'worklet';
      const w = widthSv.value || 1;
      const r = e.x / w;
      runOnJS(seekToRatio)(r);
    });

  const filledCount = Math.round(progress * BAR_COUNT);

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.wrap} onLayout={onLayout} testID={testID} collapsable={false}>
        {bars.map((h, i) => {
          const filled = i < filledCount;
          return (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: 8 + h * 24,
                  backgroundColor: filled ? COLORS.brand : 'rgba(255,255,255,0.18)',
                },
              ]}
            />
          );
        })}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    gap: 2,
  },
  bar: {
    flex: 1,
    borderRadius: 1.5,
  },
});
