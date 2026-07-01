import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../store/theme';
import { type ToastEntry, useToastStore } from '../store/toast';
import { type AppColors, Radius, Spacing, Typography } from '../styles/tokens';

function ToastItem({ entry }: { entry: ToastEntry }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;
  const dismiss = useToastStore((state) => state.dismiss);
  const { colors } = useAppTheme();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) dismiss(entry.id);
        },
      );
    }, 3000);
    return () => clearTimeout(timer);
  }, [dismiss, entry.id, opacity, translateY]);

  const close = () => {
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
      dismiss(entry.id),
    );
  };
  const palette = variantColors(entry.variant, colors);

  return (
    <Animated.View
      accessible
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        { backgroundColor: palette.background, opacity, transform: [{ translateY }] },
      ]}
    >
      <Text style={[styles.message, { color: palette.text }]}>{entry.message}</Text>
      <TouchableOpacity
        accessibilityLabel="Dismiss notification"
        accessibilityRole="button"
        onPress={close}
        style={styles.dismiss}
      >
        <Text style={[styles.dismissLabel, { color: palette.text }]}>×</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function variantColors(variant: ToastEntry['variant'], colors: AppColors) {
  if (variant === 'success') return { background: colors.successContainer, text: colors.success };
  if (variant === 'error') return { background: colors.errorContainer, text: colors.error };
  if (variant === 'warning') return { background: colors.warningContainer, text: colors.warning };
  return { background: colors.infoContainer, text: colors.info };
}

export function Toast() {
  const queue = useToastStore((state) => state.queue);
  const { top } = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.queue, { top: top + Spacing.sm }]}>
      {queue.map((entry) => (
        <ToastItem entry={entry} key={entry.id} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  queue: { position: 'absolute', left: 16, right: 16, zIndex: 9999, gap: Spacing.sm },
  card: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.lg,
  },
  message: { ...Typography.captionBold, flex: 1 },
  dismiss: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.sm,
  },
  dismissLabel: { fontSize: 22, lineHeight: 24 },
});
