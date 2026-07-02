import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatNumber, humanizeStatus, timeAgo } from '../lib/format';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';
import type { Job } from '../types';
import { StatusBadge } from './StatusBadge';

interface JobCardProps {
  job: Job;
  onPress: () => void;
}

function jobLabel(id: string): string {
  return `Job #${id.slice(0, 8)}`;
}

export function JobCard({ job, onPress }: JobCardProps) {
  const { colors } = useAppTheme();
  const userLabel = job.userEmail ?? job.userId ?? 'Unknown user';
  const creditsLabel = `${formatNumber(job.creditsCharged)} ${job.creditsCharged === 1 ? 'credit' : 'credits'}`;
  const createdLabel = timeAgo(job.createdAt);
  const facePoselabel = [job.faceLabel, job.poseLabel].filter(Boolean).join(' · ');
  const hasAddons = job.hasLower || job.hasShoe;

  return (
    <TouchableOpacity
      accessibilityHint="Opens job details"
      accessibilityLabel={`${jobLabel(job.id)}, ${humanizeStatus(job.status)}, ${userLabel}, ${creditsLabel}, created ${createdLabel}`}
      accessibilityRole="button"
      activeOpacity={0.75}
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.header}>
        <StatusBadge status={job.status} />
        <Text numberOfLines={1} style={[styles.user, { color: colors.textSecondary }]}>
          {userLabel}
        </Text>
      </View>
      <View style={styles.details}>
        <Text numberOfLines={1} style={[styles.jobId, { color: colors.text }]}>
          {jobLabel(job.id)}
        </Text>
        <Text style={[styles.credits, { color: colors.textSecondary }]}>{creditsLabel}</Text>
      </View>
      {facePoselabel || hasAddons ? (
        <View style={styles.metaRow}>
          {facePoselabel ? (
            <Text numberOfLines={1} style={[styles.meta, { color: colors.textMuted }]}>
              {facePoselabel}
            </Text>
          ) : (
            <View style={styles.flex} />
          )}
          {hasAddons ? (
            <View style={styles.badges}>
              {job.hasLower ? (
                <View style={[styles.badge, { backgroundColor: colors.accentContainer }]}>
                  <Text style={[styles.badgeText, { color: colors.onAccentContainer }]}>Lower</Text>
                </View>
              ) : null}
              {job.hasShoe ? (
                <View style={[styles.badge, { backgroundColor: colors.warningContainer }]}>
                  <Text style={[styles.badgeText, { color: colors.warning }]}>Shoe</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
      <Text style={[styles.created, { color: colors.textMuted }]}>{createdLabel}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.xl,
    gap: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  user: {
    ...Typography.caption,
    flex: 1,
    textAlign: 'right',
  },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  jobId: {
    ...Typography.bodyBold,
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  credits: {
    ...Typography.captionBold,
    fontVariant: ['tabular-nums'],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  flex: { flex: 1 },
  meta: {
    ...Typography.caption,
    flex: 1,
  },
  badges: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  badgeText: {
    ...Typography.label,
    fontSize: 10,
  },
  created: {
    ...Typography.caption,
  },
});
