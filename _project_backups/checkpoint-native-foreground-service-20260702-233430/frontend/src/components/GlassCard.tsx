import React from 'react';
import { View, StyleSheet, Platform, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { COLORS, RADIUS } from '@/src/theme/tokens';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  intensity?: number;
  testID?: string;
};

export default function GlassCard({ children, style, intensity = 30, testID }: Props) {
  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <BlurView
        intensity={Platform.OS === 'ios' ? intensity : intensity + 30}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.tint} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(18,18,26,0.55)',
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(18,18,26,0.45)',
  },
  content: {
    padding: 16,
  },
});
