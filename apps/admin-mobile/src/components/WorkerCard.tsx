import { StyleSheet, Text, View } from 'react-native';
import { humanizeStatus, timeAgo } from '../lib/format';
import { useAppTheme } from '../store/theme';
import { type AppColors, Radius, Spacing, Typography } from '../styles/tokens';
import type { DashboardWorker } from '../types';

interface WorkerCardProps {
  worker: DashboardWorker;
}

function getWorkerStatusColor(status: string, healthy: boolean, colors: AppColors) {
  if (!healthy) return colors.error;
  const s = status.toUpperCase();
  switch (s) {
    case 'IDLE':
      return colors.success;
    case 'BUSY':
      return colors.info;
    case 'DRAINING':
      return colors.warning;
    case 'OFFLINE':
      return colors.textMuted;
    default:
      return colors.error;
  }
}

export function WorkerCard({ worker }: WorkerCardProps) {
  const { colors } = useAppTheme();
  const statusLabel = humanizeStatus(worker.status) || 'Unknown';
  const statusColor = getWorkerStatusColor(worker.status, worker.healthy, colors);
  const lastSeenLabel = worker.lastSeen ? timeAgo(worker.lastSeen) : 'Never';

  return (
    <View
      accessible
      accessibilityLabel={`${worker.id}, ${statusLabel}, last seen ${lastSeenLabel}`}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.header}>
        <View style={styles.identity}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
            {worker.id}
          </Text>
        </View>
        <View style={[styles.status, { borderColor: statusColor }]}>
          <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>
      <Text style={[styles.lastSeen, { color: colors.textMuted }]}>Last seen {lastSeenLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.xl,
    gap: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  identity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
  },
  name: {
    ...Typography.bodyBold,
    flex: 1,
  },
  status: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  statusLabel: {
    ...Typography.captionBold,
  },
  lastSeen: {
    ...Typography.caption,
  },
});
