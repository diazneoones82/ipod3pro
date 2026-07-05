import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Svg, { Path, Line, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { COLORS } from '@/src/theme/tokens';
import { computeFrequencyResponse } from '@/src/utils/biquad';
import type { EQBand } from '@/src/utils/eq-parser';

type Props = {
  bands: EQBand[];
  preamp: number;
  width: number;
  height: number;
};

const DB_RANGE = 18; // -18..+18

export default function FrequencyGraph({ bands, preamp, width, height }: Props) {
  const data = useMemo(() => computeFrequencyResponse(bands, preamp, 96), [bands, preamp]);

  const xFor = (i: number) => (i / (data.length - 1)) * width;
  const yFor = (db: number) => {
    const clamped = Math.max(-DB_RANGE, Math.min(DB_RANGE, db));
    return height / 2 - (clamped / DB_RANGE) * (height / 2 - 8);
  };

  // Smooth path
  const pathD = useMemo(() => {
    if (data.length === 0) return '';
    let d = `M ${xFor(0)} ${yFor(data[0].db)}`;
    for (let i = 1; i < data.length; i++) {
      d += ` L ${xFor(i)} ${yFor(data[i].db)}`;
    }
    return d;
  }, [data, width, height]);

  // Fill area under curve to zero
  const fillD = useMemo(() => {
    if (data.length === 0) return '';
    const zeroY = yFor(0);
    let d = `M ${xFor(0)} ${zeroY}`;
    for (let i = 0; i < data.length; i++) d += ` L ${xFor(i)} ${yFor(data[i].db)}`;
    d += ` L ${xFor(data.length - 1)} ${zeroY} Z`;
    return d;
  }, [data, width, height]);

  // Freq labels at decade markers
  const labels = [
    { hz: 32, label: '32' },
    { hz: 100, label: '100' },
    { hz: 1000, label: '1K' },
    { hz: 10000, label: '10K' },
  ];
  const logMin = Math.log10(20);
  const logMax = Math.log10(20000);
  const xForHz = (hz: number) => ((Math.log10(hz) - logMin) / (logMax - logMin)) * width;

  return (
    <View style={[styles.wrap, { width, height }]}>
      <Svg width={width} height={height}>
        <Defs>
          <SvgGrad id="curveFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={COLORS.brand} stopOpacity="0.45" />
            <Stop offset="1" stopColor={COLORS.brand} stopOpacity="0.05" />
          </SvgGrad>
        </Defs>
        {/* grid */}
        <Line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="3,3" />
        <Line x1={0} y1={yFor(6)} x2={width} y2={yFor(6)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        <Line x1={0} y1={yFor(-6)} x2={width} y2={yFor(-6)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        <Line x1={0} y1={yFor(12)} x2={width} y2={yFor(12)} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
        <Line x1={0} y1={yFor(-12)} x2={width} y2={yFor(-12)} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />

        <Path d={fillD} fill="url(#curveFill)" />
        <Path d={pathD} stroke={COLORS.brand} strokeWidth={2.5} fill="none" />
      </Svg>
      <View style={styles.labelsRow} pointerEvents="none">
        {labels.map((l) => (
          <Text key={l.hz} style={[styles.label, { left: xForHz(l.hz) - 10 }]}>{l.label}</Text>
        ))}
      </View>
      <Text style={[styles.dbLabel, { top: 4 }]}>+{DB_RANGE}</Text>
      <Text style={[styles.dbLabel, { bottom: 16 }]}>-{DB_RANGE}</Text>
      <Text style={[styles.dbLabel, { top: height / 2 - 8 }]}>0 dB</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  labelsRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 14,
  },
  label: {
    position: 'absolute',
    color: COLORS.onSurfaceTertiary,
    fontSize: 10,
  },
  dbLabel: {
    position: 'absolute',
    right: 4,
    color: COLORS.onSurfaceTertiary,
    fontSize: 9,
  },
});
