import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccordionSection } from '../../../components/AccordionSection';
import { EmptyState } from '../../../components/EmptyState';
import { EventTimeline } from '../../../components/EventTimeline';
import { ImagePreview } from '../../../components/ImagePreview';
import { SkeletonLoader } from '../../../components/SkeletonLoader';
import { StatusBadge } from '../../../components/StatusBadge';
import { useAdminJobStream } from '../../../hooks/useAdminJobStream';
import { useApi } from '../../../hooks/useApi';
import { useJobNotifications } from '../../../hooks/useJobNotifications';
import { ApiError, apiFetch } from '../../../lib/api';
import { formatDate, formatNumber } from '../../../lib/format';
import { useAuthStore } from '../../../store/auth';
import { useAppTheme } from '../../../store/theme';
import { useToastStore } from '../../../store/toast';
import { Radius, Spacing, Typography } from '../../../styles/tokens';
import type { AdminJobEvent, JobDetail, JobEvent, JobStatus } from '../../../types';

const CANCELLABLE: JobStatus[] = ['QUEUED', 'PREPROCESSING', 'GENERATING', 'UPLOADING'];

export default function JobDetailScreen() {
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useAuthStore((state) => state.role);
  const canWrite = role !== 'SUPPORT';
  const { data, loading, error, refresh } = useApi<JobDetail>(`/admin/jobs/${id}`);
  const [liveStatus, setLiveStatus] = useState<JobStatus | null>(null);
  const [liveEvents, setLiveEvents] = useState<JobEvent[]>([]);
  const [actioning, setActioning] = useState<'cancel' | 'retry' | null>(null);
  const [preview, setPreview] = useState<{ uri: string; label: string } | null>(null);

  useEffect(() => {
    setLiveStatus(null);
    setLiveEvents([]);
    setPreview(null);
  }, []);

  const onStreamEvent = useCallback(
    (event: AdminJobEvent) => {
      setLiveStatus(event.status);
      setLiveEvents((current) => [
        {
          id: `live-${event.jobId}-${event.status}-${Date.now()}`,
          jobId: event.jobId,
          eventType: event.status,
          createdAt: new Date().toISOString(),
          payload: { workerId: event.workerId, errorCode: event.errorCode },
        },
        ...current,
      ]);
      if (event.status === 'COMPLETED' || event.status === 'FAILED') {
        setLiveEvents([]);
        void refresh();
      }
    },
    [refresh],
  );

  useAdminJobStream(id, onStreamEvent);

  const events = useMemo(
    () => [...liveEvents, ...(data?.events ?? [])],
    [data?.events, liveEvents],
  );
  const status = liveStatus ?? data?.status;
  useJobNotifications(id, status);

  async function runAction(action: 'cancel' | 'retry') {
    setActioning(action);
    try {
      await apiFetch<{ ok: boolean }>(`/admin/jobs/${id}/${action}`, { method: 'POST' });
      setLiveEvents([]);
      setLiveStatus(null);
      await refresh();
      useToastStore
        .getState()
        .show(action === 'cancel' ? 'Job cancelled' : 'Job queued for retry', 'success');
    } catch (cause) {
      Alert.alert('Action failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setActioning(null);
    }
  }

  function confirmCancel() {
    Alert.alert('Cancel job?', 'The charged credits will be refunded.', [
      { text: 'Keep job', style: 'cancel' },
      { text: 'Cancel job', style: 'destructive', onPress: () => void runAction('cancel') },
    ]);
  }

  if (loading && !data) {
    return (
      <ScrollView contentContainerStyle={[styles.loadingContent, { backgroundColor: colors.bg }]}>
        <SkeletonLoader count={3} variant="detail" />
      </ScrollView>
    );
  }
  if (error && !data) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="Job not found"
          message="This job may have been deleted or the link is invalid."
        />
      );
    }
    return (
      <EmptyState
        actionLabel="Retry"
        message={error.message}
        onAction={() => void refresh()}
        title="Job unavailable"
      />
    );
  }
  if (!data || !status) return null;

  const images = Object.entries(data.inputImages).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { backgroundColor: colors.bg, paddingBottom: bottom + 100 },
        ]}
      >
        {error ? (
          <Text style={[styles.staleWarning, { color: colors.warning }]}>
            Refresh failed. Showing current job data.
          </Text>
        ) : null}
        <View
          style={[
            styles.summaryCard,
            { backgroundColor: colors.accentContainer, borderColor: colors.border },
          ]}
        >
          <View style={styles.summaryHeader}>
            <StatusBadge status={status} />
            <Text style={[styles.jobId, { color: colors.onAccentContainer }]}>
              #{data.id.slice(0, 8)}
            </Text>
          </View>
          <Text style={[styles.user, { color: colors.onAccentContainer }]}>
            {data.userEmail ?? data.userId ?? 'Unknown user'}
          </Text>
          <View style={styles.metrics}>
            <Metric label="Credits" value={formatNumber(data.creditsCharged)} />
            <Metric label="Priority" value={data.priority ? 'Priority' : 'Normal'} />
            <Metric label="Attempts" value={formatNumber(data.attempts ?? 0)} />
          </View>
          <Text style={[styles.created, { color: colors.onAccentContainer }]}>
            Created {formatDate(data.createdAt)}
          </Text>
          {data.startedAt ? (
            <Text style={[styles.created, { color: colors.onAccentContainer }]}>
              Started {formatDate(data.startedAt)}
            </Text>
          ) : null}
          {data.completedAt ? (
            <Text style={[styles.created, { color: colors.onAccentContainer }]}>
              Completed {formatDate(data.completedAt)}
            </Text>
          ) : null}
          {data.errorCode ? (
            <Text style={[styles.errorCode, { color: colors.error }]}>Error: {data.errorCode}</Text>
          ) : null}
        </View>

        {data.faceLabel ||
        data.backgroundLabel ||
        data.poseLabel ||
        data.workflowLabel ||
        data.workerId ? (
          <AccordionSection title="Job Info" initiallyExpanded>
            {data.faceLabel ? <JobInfoRow label="Face" value={data.faceLabel} /> : null}
            {data.backgroundLabel ? (
              <JobInfoRow label="Background" value={data.backgroundLabel} />
            ) : null}
            {data.poseLabel ? <JobInfoRow label="Pose" value={data.poseLabel} /> : null}
            {data.workflowLabel ? <JobInfoRow label="Workflow" value={data.workflowLabel} /> : null}
            {data.workerId ? <JobInfoRow label="Worker" value={data.workerId} /> : null}
          </AccordionSection>
        ) : null}

        {canWrite && (CANCELLABLE.includes(status) || status === 'FAILED') ? (
          <View style={styles.actions}>
            {CANCELLABLE.includes(status) ? (
              <ActionButton
                destructive
                loading={actioning === 'cancel'}
                disabled={actioning !== null}
                label="Cancel Job"
                onPress={confirmCancel}
              />
            ) : null}
            {status === 'FAILED' ? (
              <ActionButton
                loading={actioning === 'retry'}
                disabled={actioning !== null}
                label="Retry Job"
                onPress={() => void runAction('retry')}
              />
            ) : null}
          </View>
        ) : null}

        {data.outputUrl ? (
          <AccordionSection title="Output">
            <TouchableOpacity
              accessibilityHint="Opens fullscreen image preview"
              accessibilityRole="button"
              onPress={() =>
                setPreview({ uri: data.outputUrl ?? '', label: 'Generated job output' })
              }
            >
              <Image
                accessibilityLabel="Generated job output"
                contentFit="cover"
                source={{ uri: data.outputUrl }}
                style={[styles.outputImage, { backgroundColor: colors.bgSecondary }]}
              />
            </TouchableOpacity>
          </AccordionSection>
        ) : null}

        <AccordionSection title="Input Images">
          {images.length === 0 ? (
            <Text style={[styles.muted, { color: colors.textMuted }]}>
              No input images available.
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.images}
            >
              {images.map(([label, uri]) => (
                <TouchableOpacity
                  accessibilityHint="Opens fullscreen image preview"
                  accessibilityRole="button"
                  key={label}
                  onPress={() => setPreview({ uri, label: `${label} input` })}
                  style={styles.imageItem}
                >
                  <Image
                    accessibilityLabel={`${label} input`}
                    source={{ uri }}
                    style={[styles.inputImage, { backgroundColor: colors.bgSecondary }]}
                  />
                  <Text style={[styles.imageLabel, { color: colors.textSecondary }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </AccordionSection>

        {data.userHint ? (
          <AccordionSection title="User Hint">
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{data.userHint}</Text>
          </AccordionSection>
        ) : null}
        <AccordionSection title="Events">
          <EventTimeline events={events} />
        </AccordionSection>
      </ScrollView>
      <ImagePreview
        label={preview?.label ?? ''}
        onClose={() => setPreview(null)}
        uri={preview?.uri ?? null}
        visible={preview !== null}
      />
    </>
  );
}

function JobInfoRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.infoValue, { color: colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.metric, { backgroundColor: colors.glass }]}>
      <Text style={[styles.metricValue, { color: colors.onAccentContainer }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.onAccentContainer }]}>{label}</Text>
    </View>
  );
}
function ActionButton({
  label,
  onPress,
  destructive = false,
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor: destructive ? colors.error : colors.accent },
        disabled && styles.disabledButton,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.onAccent} />
      ) : (
        <Text style={[styles.buttonLabel, { color: colors.onAccent }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.lg },
  loadingContent: { padding: Spacing.lg },
  summaryCard: { padding: Spacing.lg, borderRadius: Radius.xl, borderWidth: 1, gap: Spacing.md },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  jobId: { ...Typography.code },
  user: { ...Typography.bodyBold },
  metrics: { flexDirection: 'row', gap: Spacing.sm },
  metric: { flex: 1, padding: Spacing.md, borderRadius: Radius.md },
  metricValue: { ...Typography.bodyBold, fontVariant: ['tabular-nums'] },
  metricLabel: { ...Typography.caption, marginTop: Spacing.xs, opacity: 0.72 },
  created: { ...Typography.caption, opacity: 0.72 },
  errorCode: { ...Typography.captionBold },
  actions: { flexDirection: 'row', gap: Spacing.md },
  button: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.md,
    borderRadius: Radius.full,
  },
  disabledButton: { opacity: 0.5 },
  buttonLabel: { ...Typography.bodyBold },
  outputImage: { width: '100%', aspectRatio: 1, borderRadius: Radius.lg },
  images: { gap: Spacing.md },
  imageItem: { gap: Spacing.xs },
  inputImage: { width: 112, height: 112, borderRadius: Radius.md },
  imageLabel: { ...Typography.caption, textTransform: 'capitalize' },
  hint: { ...Typography.body },
  muted: { ...Typography.body },
  staleWarning: { ...Typography.caption, textAlign: 'center' },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    gap: Spacing.md,
  },
  infoLabel: { ...Typography.caption, flexShrink: 0 },
  infoValue: { ...Typography.body, flex: 1, textAlign: 'right' },
});
