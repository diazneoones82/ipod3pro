import React, { useMemo, useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import Svg, { Path, Defs, LinearGradient, Stop, ClipPath, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

type Props = {
  progress: number;
  duration: number;
  seed: string;
  onSeek: (sec: number) => void;
  testID?: string;
};

const POINT_COUNT = 100;
const WAVE_HEIGHT = 36;
const STROKE_WIDTH = 3;
const GLOW_WIDTH = 10;
const PLAYHEAD_RADIUS = 5;
const VIBRANT_COLORS = ['#FF2BD6', '#8B5CFF', '#00F5FF', '#20FF9F', '#B6FF00', '#FFD400', '#FF5C00'];
const GLOW_COLORS = ['rgba(255,43,214,0.35)', 'rgba(139,92,255,0.35)', 'rgba(0,245,255,0.35)', 'rgba(32,255,159,0.35)', 'rgba(182,255,0,0.35)', 'rgba(255,212,0,0.35)', 'rgba(255,92,0,0.35)'];
const GRADIENT_STOPS = VIBRANT_COLORS.map((c, i) => ({ color: c, offset: `${Math.round((i / (VIBRANT_COLORS.length - 1)) * 100)}%` }));

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

function generateWave(seed: string, count: number): number[] {
  const rng = mulberry32(hashStr(seed || 'empty') || 1);
  const arr: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const env = 0.55 + 0.4 * Math.sin(t * Math.PI);
    const noise = 0.35 + rng() * 0.65;
    arr.push(Math.max(0.18, Math.min(1, env * noise)));
  }
  return arr;
}

function buildWavePath(heights: number[], width: number): string {
  if (width <= 0 || heights.length < 2) return '';
  const stepX = Math.max(1, width / (heights.length - 1));
  const midY = WAVE_HEIGHT / 2;
  const range = (WAVE_HEIGHT - STROKE_WIDTH - 4) / 2;
  const parts: string[] = [];
  for (let i = 0; i < heights.length; i++) {
    const x = i * stepX;
    const y = midY + (heights[i] - 0.5) * range;
    parts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return parts.join(' ');
}

export default function WaveformScrubber({ progress, duration, seed, onSeek, testID }: Props) {
  const [width, setWidth] = useState(0);
  const widthSv = useSharedValue(0);

  const heights = useMemo(() => generateWave(seed || 'empty', POINT_COUNT), [seed]);

  const fullPath = useMemo(() => buildWavePath(heights, width), [heights, width]);

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

  const clampedProgress = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const clipWidth = clampedProgress * (width || 1);

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.wrap} onLayout={onLayout} testID={testID} collapsable={false}>
        {width > 0 && (
          <Svg width={width} height={WAVE_HEIGHT} viewBox={`0 0 ${width} ${WAVE_HEIGHT}`}>
            <Defs>
              <LinearGradient id="waveGrad" x1="0" y1="0" x2="1" y2="0">
                {GRADIENT_STOPS.map((s, i) => (
                  <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={0.18} />
                ))}
              </LinearGradient>
              <LinearGradient id="waveGradFilled" x1="0" y1="0" x2="1" y2="0">
                {GRADIENT_STOPS.map((s, i) => (
                  <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={1} />
                ))}
              </LinearGradient>
              <LinearGradient id="waveGradGlow" x1="0" y1="0" x2="1" y2="0">
                {GLOW_COLORS.map((c, i) => (
                  <Stop key={i} offset={GRADIENT_STOPS[i].offset} stopColor={c} stopOpacity={1} />
                ))}
              </LinearGradient>
              <ClipPath id="clip">
                <Rect x={0} y={0} width={clipWidth} height={WAVE_HEIGHT} />
              </ClipPath>
            </Defs>

            {/* unfilled — very subtle */}
            <Path
              d={fullPath}
              stroke="url(#waveGrad)"
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* glow behind filled section */}
            <Path
              d={fullPath}
              stroke="url(#waveGradGlow)"
              strokeWidth={GLOW_WIDTH}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath="url(#clip)"
            />

            {/* filled section */}
            <Path
              d={fullPath}
              stroke="url(#waveGradFilled)"
              strokeWidth={STROKE_WIDTH}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath="url(#clip)"
            />

            {/* playhead dot */}
            {clampedProgress > 0 && clampedProgress < 1 && (
              <Path
                d={(() => {
                  const idx = Math.round(clampedProgress * (heights.length - 1));
                  const stepX = Math.max(1, width / (heights.length - 1));
                  const x = idx * stepX;
                  const midY = WAVE_HEIGHT / 2;
                  const range = (WAVE_HEIGHT - STROKE_WIDTH - 4) / 2;
                  const y = midY + (heights[idx] - 0.5) * range;
                  return `M ${x} ${y - PLAYHEAD_RADIUS} A ${PLAYHEAD_RADIUS} ${PLAYHEAD_RADIUS} 0 1 1 ${x} ${y + PLAYHEAD_RADIUS} A ${PLAYHEAD_RADIUS} ${PLAYHEAD_RADIUS} 0 1 1 ${x} ${y - PLAYHEAD_RADIUS}`;
                })()}
                fill="#FFFFFF"
              />
            )}
          </Svg>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: WAVE_HEIGHT + 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
  },
});
