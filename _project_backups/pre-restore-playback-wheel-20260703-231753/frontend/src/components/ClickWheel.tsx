import React, { useCallback } from 'react';
import { View, Pressable, StyleSheet, Text, Platform, Vibration } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, runOnJS } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/src/theme/tokens';

export type ClickWheelAction = 'menu' | 'prev' | 'next' | 'play' | 'stop' | 'select' | 'scrollUp' | 'scrollDown';

type Props = {
  size?: number;
  mode?: 'volume' | 'track';
  hapticStrength?: number;
  onAction: (a: ClickWheelAction) => void;
};

const TICK_STEP_RAD = (2 * Math.PI) / 36; // 36 ticks per full rotation = 10° per tick

export default function ClickWheel({ size = 280, mode = 'volume', hapticStrength = 70, onAction }: Props) {
  const accumAngle = useSharedValue(0);
  const lastAngle = useSharedValue(0);
  const dragging = useSharedValue(0);
  const ringScale = useSharedValue(1);

  const center = size / 2;
  const innerSize = size * 0.42;

  const triggerHaptic = useCallback((kind: 'tick' | 'button' = 'tick') => {
    const strength = Math.max(0, Math.min(100, Math.round(hapticStrength)));
    if (strength <= 0) return;
    const style = strength >= 67
      ? Haptics.ImpactFeedbackStyle.Heavy
      : strength >= 34
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light;
    Haptics.impactAsync(style).catch(() => {});
    if (Platform.OS === 'android') {
      const maxMs = kind === 'button' ? 34 : 22;
      Vibration.vibrate(Math.max(1, Math.round((strength / 100) * maxMs)));
    }
  }, [hapticStrength]);

  const handleAngleChange = useCallback((deltaTicks: number) => {
    if (deltaTicks === 0) return;
    triggerHaptic();
    if (deltaTicks > 0) {
      for (let i = 0; i < deltaTicks; i++) onAction('scrollUp');
    } else {
      for (let i = 0; i < -deltaTicks; i++) onAction('scrollDown');
    }
  }, [onAction, triggerHaptic]);

  const panGesture = Gesture.Pan()
    .onBegin((e) => {
      'worklet';
      const dx = e.x - center;
      const dy = e.y - center;
      lastAngle.value = Math.atan2(dy, dx);
      dragging.value = 1;
      ringScale.value = withTiming(1.02, { duration: 120 });
      accumAngle.value = 0;
    })
    .onUpdate((e) => {
      'worklet';
      const dx = e.x - center;
      const dy = e.y - center;
      const r = Math.sqrt(dx * dx + dy * dy);
      // only consider as ring scroll if pointer is on the ring zone
      if (r < innerSize / 2 + 8 || r > size / 2 + 8) return;
      const ang = Math.atan2(dy, dx);
      let delta = ang - lastAngle.value;
      // unwrap
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      accumAngle.value += delta;
      lastAngle.value = ang;
      const ticks = Math.trunc(accumAngle.value / TICK_STEP_RAD);
      if (ticks !== 0) {
        accumAngle.value -= ticks * TICK_STEP_RAD;
        runOnJS(handleAngleChange)(ticks);
      }
    })
    .onFinalize(() => {
      'worklet';
      dragging.value = 0;
      ringScale.value = withTiming(1, { duration: 160 });
    });

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
  }));

  const fireAction = (a: ClickWheelAction) => {
    triggerHaptic('button');
    onAction(a);
  };

  return (
    <GestureHandlerRootView style={{ width: size, height: size, position: 'relative' }}>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.outerContainer, { width: size, height: size }, ringStyle]} testID="click-wheel">
          {/* Chrome ring layered gradients */}
          <LinearGradient
            colors={[COLORS.chromeLight, COLORS.chromeMid, COLORS.chromeDark, COLORS.chromeMid, COLORS.chromeLight]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}
          />
          <LinearGradient
            colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.45)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={[styles.ringOverlay, { width: size, height: size, borderRadius: size / 2 }]}
            pointerEvents="none"
          />
          {/* Inner cutout / dark surface */}
          <View
            style={[
              styles.innerHole,
              { width: innerSize, height: innerSize, borderRadius: innerSize / 2, top: center - innerSize / 2, left: center - innerSize / 2 },
            ]}
            pointerEvents="none"
          >
            <BlurView intensity={Platform.OS === 'ios' ? 60 : 80} tint="dark" style={[StyleSheet.absoluteFill, { borderRadius: innerSize / 2, overflow: 'hidden' }]} />
          </View>
        </Animated.View>
      </GestureDetector>
      <Pressable
        testID="click-wheel-select"
        onPress={() => fireAction('select')}
        style={({ pressed }) => [
          styles.centerButton,
          {
            width: innerSize - 12,
            height: innerSize - 12,
            borderRadius: (innerSize - 12) / 2,
            top: center - (innerSize - 12) / 2,
            left: center - (innerSize - 12) / 2,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <LinearGradient
          colors={['#1A1A24', '#0A0A12']}
          style={[StyleSheet.absoluteFill, { borderRadius: (innerSize - 12) / 2 }]}
        />
        <View style={styles.centerInner}>
          <Text style={styles.centerLabel}>SELECT</Text>
        </View>
      </Pressable>

      <Pressable
        testID="click-wheel-menu"
        onPress={() => fireAction('menu')}
        style={[styles.dirBtn, { top: 8, left: center - 32 }]}
        hitSlop={14}
      >
        <Text style={styles.dirLabel}>MENU</Text>
      </Pressable>

      <Pressable
        testID="click-wheel-play"
        onPress={() => fireAction('play')}
        style={[styles.dirBtn, styles.playBtn, { bottom: 2, left: center - 30 }]}
        hitSlop={16}
      >
        <Ionicons name="play" size={14} color={COLORS.surface} />
        <Ionicons name="pause" size={14} color={COLORS.surface} style={{ marginLeft: 2 }} />
      </Pressable>

      <Pressable
        testID="click-wheel-prev"
        onPress={() => fireAction('prev')}
        style={[styles.dirBtn, styles.skipBtn, mode === 'volume' && styles.skipBtnMuted, { left: 14, top: center - 16 }]}
        hitSlop={16}
      >
        <Ionicons name="play-skip-back" size={16} color={COLORS.surface} />
      </Pressable>

      <Pressable
        testID="click-wheel-next"
        onPress={() => fireAction('next')}
        style={[styles.dirBtn, styles.skipBtn, mode === 'volume' && styles.skipBtnMuted, { right: 14, top: center - 16 }]}
        hitSlop={16}
      >
        <Ionicons name="play-skip-forward" size={16} color={COLORS.surface} />
      </Pressable>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 20,
  },
  ring: {
    position: 'absolute',
    top: 0, left: 0,
  },
  ringOverlay: {
    position: 'absolute',
    top: 0, left: 0,
  },
  innerHole: {
    position: 'absolute',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,5,10,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  centerButton: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    zIndex: 4,
  },
  centerInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLabel: {
    color: '#A0A0AB',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '600',
  },
  dirBtn: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    minWidth: 36,
    minHeight: 36,
    zIndex: 5,
  },
  playBtn: {
    minWidth: 60,
  },
  skipBtn: {
    opacity: 1,
  },
  skipBtnMuted: {
    opacity: 0.35,
  },
  dirLabel: {
    color: COLORS.surface,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
});
