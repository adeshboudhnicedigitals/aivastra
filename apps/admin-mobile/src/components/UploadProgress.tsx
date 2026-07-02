import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { UploadPhase } from '../lib/upload';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

const LABELS: Record<Exclude<UploadPhase, null>, string> = {
  'uploading-main': 'Uploading image…',
  'uploading-thumbnail': 'Creating thumbnail…',
  confirming: 'Saving…',
};

export function UploadProgress({ phase, progress }: { phase: UploadPhase; progress: number }) {
  const { colors } = useAppTheme();
  const animated = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(animated, {
      toValue: Math.max(0, Math.min(100, progress)) / 100,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [animated, progress]);
  if (!phase) return null;
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{LABELS[phase]}</Text>
        <Text style={[styles.value, { color: colors.accent }]}>{Math.round(progress)}%</Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.surfaceVariant }]}>
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: colors.accent, transform: [{ scaleX: animated }] },
          ]}
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: Spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { ...Typography.captionBold },
  value: { ...Typography.captionBold, fontVariant: ['tabular-nums'] },
  track: { height: 8, overflow: 'hidden', borderRadius: Radius.full },
  fill: { width: '100%', height: '100%', borderRadius: Radius.full, transformOrigin: 'left' },
});
