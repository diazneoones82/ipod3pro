import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, Text, LayoutChangeEvent } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { COLORS } from '@/src/theme/tokens';

type Props = {
  min: number;
  max: number;
  value: number;
  step?: number;
  label?: string;
  unit?: string;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  testID?: string;
  // optional log scale (for freq)
  logScale?: boolean;
};

export default function CustomSlider({
  min, max, value, step = 0, label, unit, onChange, formatValue, testID, logScale = false,
}: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth(w);
    widthRef.current = w;
  };

  const ratio = (v: number) => {
    if (logScale) {
      const lmin = Math.log(min);
      const lmax = Math.log(max);
      return (Math.log(Math.max(min, v)) - lmin) / (lmax - lmin);
    }
    return (v - min) / (max - min);
  };
  const invRatio = (r: number) => {
    const cl = Math.max(0, Math.min(1, r));
    if (logScale) {
      const lmin = Math.log(min);
      const lmax = Math.log(max);
      return Math.exp(lmin + cl * (lmax - lmin));
    }
    return min + cl * (max - min);
  };

  const progress = useSharedValue(ratio(value));
  // Keep in sync when value changes externally
  React.useEffect(() => { progress.value = ratio(value); }, [value]); // eslint-disable-line

  const setValueFromRatio = useCallback((r: number) => {
    let v = invRatio(r);
    if (step > 0) v = Math.round(v / step) * step;
    onChange(v);
  }, [onChange, step]); // eslint-disable-line

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      const w = widthRef.current || 1;
      const r = Math.max(0, Math.min(1, e.x / w));
      progress.value = r;
      runOnJS(setValueFromRatio)(r);
    })
    .onBegin((e) => {
      'worklet';
      const w = widthRef.current || 1;
      const r = Math.max(0, Math.min(1, e.x / w));
      progress.value = r;
      runOnJS(setValueFromRatio)(r);
    });

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: `${progress.value * 100}%`,
  }));

  const display = formatValue ? formatValue(value) : `${value.toFixed(unit === 'Hz' ? 0 : 2)}${unit ? ` ${unit}` : ''}`;

  return (
    <View style={styles.wrap} testID={testID}>
      {(label != null || display) && (
        <View style={styles.labelRow}>
          {label != null && <Text style={styles.label}>{label}</Text>}
          <Text style={styles.value}>{display}</Text>
        </View>
      )}
      <GestureDetector gesture={pan}>
        <View style={styles.trackHit} onLayout={onLayout} collapsable={false}>
          <View style={styles.track}>
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
          <Animated.View style={[styles.thumb, thumbStyle]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label: { color: COLORS.onSurfaceSecondary, fontSize: 12, letterSpacing: 0.5 },
  value: { color: COLORS.onSurface, fontSize: 12, fontWeight: '600' },
  trackHit: {
    height: 28,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: COLORS.brand,
  },
  thumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.brand,
    marginLeft: -8,
    top: 6,
    shadowColor: COLORS.brand,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
});
