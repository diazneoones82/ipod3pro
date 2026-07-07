import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, runOnJS } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { COLORS, SPACING, RADIUS } from '@/src/theme/tokens';
import { usePlayer, currentTrack } from '@/src/state/PlayerContext';

const ITEM_HEIGHT = 62;

export default function QueueScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const player = usePlayer();
  const track = currentTrack(player);
  const [localQueue, setLocalQueue] = useState(player.queue);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const syncQueue = useCallback(() => {
    setLocalQueue([...player.queue]);
  }, [player.queue]);

  React.useEffect(() => {
    syncQueue();
  }, [syncQueue]);

  const handlePlay = useCallback((idx: number) => {
    player.playQueueIndex(idx);
  }, [player]);

  const handleRemove = useCallback((idx: number) => {
    Alert.alert('Remove', 'Remove this track from the queue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => player.removeFromQueue(idx),
      },
    ]);
  }, [player]);

  const handleMove = useCallback((from: number, to: number) => {
    player.moveInQueue(from, to);
  }, [player]);

  const renderItem = useCallback(({ item, index }: { item: any; index: number }) => {
    const isCurrent = index === player.currentIndex;
    const isPast = index < player.currentIndex;
    const isUpcoming = index > player.currentIndex;

    return (
      <DraggableRow
        item={item}
        index={index}
        isCurrent={isCurrent}
        isPast={isPast}
        isUpcoming={isUpcoming}
        onPress={() => handlePlay(index)}
        onRemove={() => handleRemove(index)}
        onMove={handleMove}
        queueLength={localQueue.length}
      />
    );
  }, [player.currentIndex, localQueue.length, handlePlay, handleRemove, handleMove]);

  if (localQueue.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
          </Pressable>
          <Text style={styles.title}>Play Queue</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="musical-notes-outline" size={48} color={COLORS.onSurfaceTertiary} />
          <Text style={styles.emptyText}>Queue is empty</Text>
          <Text style={styles.emptySubtext}>Browse folders to add tracks</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.title}>Play Queue</Text>
        <Text style={styles.count}>{localQueue.length} tracks</Text>
      </View>
      <Text style={styles.info}>
        Drag handle = to reorder &middot; Tap to play &middot; Swipe to remove
      </Text>
      <FlatList
        data={localQueue}
        keyExtractor={(item, idx) => `${item.id}-${idx}`}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

function DraggableRow({
  item, index, isCurrent, isPast, isUpcoming, onPress, onRemove, onMove, queueLength,
}: {
  item: any; index: number; isCurrent: boolean; isPast: boolean; isUpcoming: boolean;
  onPress: () => void; onRemove: () => void; onMove: (from: number, to: number) => void;
  queueLength: number;
}) {
  const translateY = useSharedValue(0);
  const context = useSharedValue({ y: 0, startIndex: index });
  const isDragging = useSharedValue(false);

  const panGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_event, stateManager) => {
      stateManager.activate();
    })
    .onStart(() => {
      context.value = { y: 0, startIndex: index };
      isDragging.value = true;
    })
    .onUpdate((event) => {
      translateY.value = event.translationY;
    })
    .onEnd(() => {
      const movedBy = Math.round(translateY.value / ITEM_HEIGHT);
      const targetIndex = Math.max(0, Math.min(queueLength - 1, context.value.startIndex + movedBy));
      if (targetIndex !== context.value.startIndex) {
        runOnJS(onMove)(context.value.startIndex, targetIndex);
      }
      translateY.value = withSpring(0);
      isDragging.value = false;
    })
    .onFinalize(() => {
      translateY.value = withSpring(0);
      isDragging.value = false;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    zIndex: isDragging.value ? 999 : 0,
    elevation: isDragging.value ? 10 : 0,
  }));

  const label = isCurrent ? 'NOW PLAYING' : isPast ? 'PLAYED' : 'UP NEXT';
  const labelColor = isCurrent ? COLORS.brand : isPast ? COLORS.onSurfaceTertiary : COLORS.success;

  return (
    <Animated.View style={[styles.row, animatedStyle]}>
      <GestureDetector gesture={panGesture}>
        <Pressable style={styles.dragHandle} hitSlop={8}>
          <Ionicons name="reorder-three-outline" size={20} color={COLORS.onSurfaceTertiary} />
        </Pressable>
      </GestureDetector>
      <Pressable style={styles.rowContent} onPress={onPress}>
        <View style={[styles.thumb, { opacity: isPast ? 0.5 : 1 }]}>
          {item.artworkUri ? (
            <Image source={{ uri: item.artworkUri }} style={styles.thumbImg} contentFit="cover" />
          ) : (
            <Ionicons name="musical-note" size={18} color={COLORS.onSurfaceTertiary} />
          )}
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowTitleRow}>
            <Text style={[styles.rowTitle, isPast && styles.textDim]} numberOfLines={1}>
              {item.title || item.filename.replace(/\.[^.]+$/, '')}
            </Text>
          </View>
          <Text style={[styles.rowMeta, isPast && styles.textDim]} numberOfLines={1}>
            {[item.artist, item.album].filter(Boolean).join(' · ') || item.folderName}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <View style={[styles.badge, { backgroundColor: labelColor + '22', borderColor: labelColor + '44' }]}>
            <Text style={[styles.badgeText, { color: labelColor }]}>{label}</Text>
          </View>
          <Pressable onPress={onRemove} hitSlop={8} style={styles.removeBtn}>
            <Ionicons name="close-circle-outline" size={18} color={COLORS.onSurfaceTertiary} />
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  title: { color: COLORS.onSurface, fontSize: 18, fontWeight: '800', flex: 1, textAlign: 'center' },
  count: { color: COLORS.onSurfaceTertiary, fontSize: 13, fontWeight: '600' },
  info: { color: COLORS.onSurfaceTertiary, fontSize: 11, textAlign: 'center', paddingVertical: 8, paddingHorizontal: SPACING.lg },
  listContent: { paddingHorizontal: SPACING.lg, paddingBottom: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center', minHeight: ITEM_HEIGHT,
    backgroundColor: COLORS.surface,
  },
  dragHandle: {
    width: 36, height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center',
  },
  rowContent: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  thumb: { width: 40, height: 40, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: 40, height: 40, borderRadius: 6 },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { color: COLORS.onSurface, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  rowMeta: { color: COLORS.onSurfaceSecondary, fontSize: 11, marginTop: 1 },
  textDim: { opacity: 0.5 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill, borderWidth: 1 },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  removeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { color: COLORS.onSurfaceTertiary, fontSize: 16, fontWeight: '700' },
  emptySubtext: { color: COLORS.onSurfaceTertiary, fontSize: 12 },
});
