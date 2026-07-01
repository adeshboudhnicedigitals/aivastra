import { StyleSheet, Text, View } from 'react-native';
import { humanizeStatus } from '../lib/format';
import { useAppTheme } from '../store/theme';
import { type AppColors, Radius, Spacing, Typography } from '../styles/tokens';
import type { JobStatus } from '../types';

interface Props {
  status: JobStatus | string;
  size?: 'compact' | 'full';
}
function presentation(status: string, colors: AppColors) {
  const map: Record<JobStatus, { color: string; background: string }> = {
    QUEUED: { color: colors.info, background: colors.infoContainer },
    PREPROCESSING: { color: colors.warning, background: colors.warningContainer },
    GENERATING: { color: colors.warning, background: colors.warningContainer },
    UPLOADING: { color: colors.warning, background: colors.warningContainer },
    COMPLETED: { color: colors.success, background: colors.successContainer },
    FAILED: { color: colors.error, background: colors.errorContainer },
    CANCELLED: { color: colors.textSecondary, background: colors.surfaceVariant },
  };
  return (
    map[status as JobStatus] ?? { color: colors.textSecondary, background: colors.surfaceVariant }
  );
}
export function StatusBadge({ status, size = 'compact' }: Props) {
  const { colors } = useAppTheme();
  const style = presentation(status, colors);
  const label = humanizeStatus(status) || 'Unknown';
  return (
    <View
      accessible
      accessibilityLabel={`Status: ${label}`}
      style={[styles.badge, size === 'full' && styles.full, { backgroundColor: style.background }]}
    >
      <View style={[styles.dot, { backgroundColor: style.color }]} />
      <Text style={[styles.label, { color: style.color }]}>{label}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  full: { alignSelf: 'stretch', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  label: { ...Typography.captionBold },
});
