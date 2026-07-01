import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing } from '../styles/tokens';

type Variant = 'card' | 'list' | 'detail';
export function SkeletonLoader({ variant, count = 1 }: { variant: Variant; count?: number }) {
  const opacity = useRef(new Animated.Value(0.45)).current;
  const { colors } = useAppTheme();
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar" style={styles.group}>
      {Array.from({ length: count }, (_, index) => (
        <Animated.View
          key={index}
          style={[styles.base, styles[variant], { opacity, backgroundColor: colors.surface }]}
        >
          <View style={[styles.lineWide, { backgroundColor: colors.surfaceVariant }]} />
          <View style={[styles.lineMedium, { backgroundColor: colors.surfaceVariant }]} />
          {variant === 'detail' ? (
            <View style={[styles.block, { backgroundColor: colors.bgSecondary }]} />
          ) : null}
        </Animated.View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  group: { gap: Spacing.md },
  base: { padding: Spacing.lg, borderRadius: Radius.xl, gap: Spacing.md },
  card: { minHeight: 132 },
  list: { minHeight: 106 },
  detail: { minHeight: 190 },
  lineWide: { width: '72%', height: 14, borderRadius: Radius.sm },
  lineMedium: { width: '45%', height: 12, borderRadius: Radius.sm },
  block: { flex: 1, minHeight: 96, borderRadius: Radius.md },
});
