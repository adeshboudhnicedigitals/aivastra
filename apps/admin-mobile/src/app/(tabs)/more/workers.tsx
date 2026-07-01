import { useCallback, useEffect, useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../../../components/EmptyState';
import { useApi } from '../../../hooks/useApi';
import { useRefreshOnForeground } from '../../../hooks/useRefreshOnForeground';
import { humanizeStatus, timeAgo } from '../../../lib/format';
import { useAppTheme } from '../../../store/theme';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../styles/tokens';
import type { AdminWorkerRegistryEntry, AdminWorkersResponse } from '../../../types';

function parseWorkers(data: AdminWorkersResponse | null): AdminWorkerRegistryEntry[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.sort((left, right) => left.id.localeCompare(right.id));
  }
  return [];
}

export default function WorkersScreen() {
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const workersApi = useApi<AdminWorkersResponse>('/admin/workers');
  const workers = useMemo(() => parseWorkers(workersApi.data), [workersApi.data]);
  const healthyCount = workers.filter((worker) => worker.healthy).length;
  const refresh = useCallback(() => workersApi.refresh(), [workersApi.refresh]);

  useRefreshOnForeground(refresh);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (workersApi.error && !workersApi.data) {
    return (
      <EmptyState
        title="Workers unavailable"
        message={workersApi.error.message}
        actionLabel="Retry"
        onAction={() => void refresh()}
      />
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Workers</Text>
        <View
          style={[
            styles.summaryBadge,
            {
              backgroundColor:
                healthyCount === workers.length && workers.length > 0
                  ? colors.successContainer
                  : colors.warningContainer,
            },
          ]}
        >
          <Text
            style={[
              styles.summaryText,
              {
                color:
                  healthyCount === workers.length && workers.length > 0
                    ? colors.success
                    : colors.warning,
              },
            ]}
          >
            {healthyCount} / {workers.length} healthy
          </Text>
        </View>
      </View>
      <FlatList
        contentContainerStyle={[styles.list, { paddingBottom: bottom + TabBarClearance }]}
        data={workers}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={workersApi.loading}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => <WorkerHealthCard worker={item} />}
        ListEmptyComponent={
          !workersApi.loading ? (
            <EmptyState
              title="No workers registered"
              message="Start the dispatcher with configured GPU workers."
            />
          ) : null
        }
      />
    </View>
  );
}

function WorkerHealthCard({ worker }: { worker: AdminWorkerRegistryEntry }) {
  const { colors } = useAppTheme();
  const lastSeen = worker.lastSeen ? timeAgo(worker.lastSeen) : 'Never';
  const statusColor = worker.healthy ? colors.success : colors.error;
  return (
    <View
      accessible
      accessibilityLabel={`${worker.id}, ${worker.healthy ? 'healthy' : 'unhealthy'}, ${humanizeStatus(worker.status)}, last seen ${lastSeen}`}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.identity}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text numberOfLines={1} style={[styles.workerId, { color: colors.text }]}>
            {worker.id}
          </Text>
        </View>
        <View style={[styles.healthBadge, { borderColor: statusColor }]}>
          <Text style={[styles.healthText, { color: statusColor }]}>
            {worker.healthy ? 'Healthy' : 'Unhealthy'}
          </Text>
        </View>
      </View>
      <View style={styles.metrics}>
        <Metric label="Status" value={humanizeStatus(worker.status)} />
        <Metric label="Last seen" value={lastSeen} />
      </View>
      {worker.url ? (
        <Text numberOfLines={1} style={[styles.url, { color: colors.textMuted }]}>
          {worker.url}
        </Text>
      ) : null}
      <Text style={[styles.note, { color: colors.textMuted }]}>
        GPU and VRAM metrics are not published by the worker registry.
      </Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  title: { ...Typography.h1 },
  summaryBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  summaryText: { ...Typography.captionBold },
  list: { gap: Spacing.md, padding: Spacing.lg, paddingTop: 0, paddingBottom: Spacing.xxxl },
  card: { gap: Spacing.md, padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.xl },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 9, height: 9, borderRadius: Radius.full },
  workerId: { ...Typography.bodyBold, flex: 1 },
  healthBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  healthText: { ...Typography.captionBold },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.lg },
  metric: { minWidth: 90 },
  metricLabel: { ...Typography.label },
  metricValue: { ...Typography.captionBold, marginTop: 2 },
  url: { ...Typography.caption },
  note: { ...Typography.label },
});
