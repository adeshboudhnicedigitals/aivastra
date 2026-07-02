import { useEffect } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

interface ImagePreviewProps {
  uri: string | null;
  label: string;
  visible: boolean;
  onClose: () => void;
}

export function ImagePreview({ uri, label, visible, onClose }: ImagePreviewProps) {
  const { colors } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedX.value = 0;
    savedY.value = 0;
  }, [savedScale, savedX, savedY, scale, translateX, translateY, visible]);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(4, Math.max(1, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      const boundX = Math.max(0, (width * scale.value - width) / 2);
      const boundY = Math.max(0, (height * scale.value - height) / 2);
      translateX.value = Math.max(-boundX, Math.min(boundX, translateX.value));
      translateY.value = Math.max(-boundY, Math.min(boundY, translateY.value));
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      if (scale.value > 1) {
        const boundX = Math.max(0, (width * scale.value - width) / 2);
        const boundY = Math.max(0, (height * scale.value - height) / 2);
        translateX.value = Math.max(-boundX, Math.min(boundX, savedX.value + event.translationX));
        translateY.value = Math.max(-boundY, Math.min(boundY, savedY.value + event.translationY));
      }
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const gesture = Gesture.Simultaneous(pinch, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[styles.overlay, { backgroundColor: colors.bg }]}>
          <View style={styles.header}>
            <Text numberOfLines={1} style={[styles.label, { color: colors.text }]}>
              {label}
            </Text>
            <TouchableOpacity
              accessibilityLabel="Close image preview"
              accessibilityRole="button"
              onPress={onClose}
              style={[styles.close, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.closeLabel, { color: colors.text }]}>Close</Text>
            </TouchableOpacity>
          </View>
          {uri ? (
            <GestureDetector gesture={gesture}>
              <Animated.Image
                accessibilityLabel={label}
                resizeMode="contain"
                source={{ uri }}
                style={[styles.image, { width }, animatedStyle]}
              />
            </GestureDetector>
          ) : null}
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Pinch to zoom and drag to inspect
          </Text>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, paddingTop: Spacing.xxxl, paddingBottom: Spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  label: { ...Typography.bodyBold, flex: 1 },
  close: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.full },
  closeLabel: { ...Typography.captionBold },
  image: { flex: 1, marginVertical: Spacing.lg },
  hint: { ...Typography.caption, textAlign: 'center' },
});
