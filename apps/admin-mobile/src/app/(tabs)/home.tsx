import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { JobFilter } from '../../components/FilterChips';
import { SkeletonLoader } from '../../components/SkeletonLoader';
import { SmartSearch } from '../../components/SmartSearch';
import { StatCard } from '../../components/StatCard';
import { WorkerCard } from '../../components/WorkerCard';
import { useApi } from '../../hooks/useApi';
import { useRefreshOnForeground } from '../../hooks/useRefreshOnForeground';
import { timeAgo } from '../../lib/format';
import { useAppTheme } from '../../store/theme';
import { Radius, Spacing, Typography } from '../../styles/tokens';
import type { Stats } from '../../types';

const POLL_INTERVAL_MS = 30_000;

export default function HomeScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [workersY, setWorkersY] = useState(0);
  const { colors } = useAppTheme();
  const { top, bottom } = useSafeAreaInsets();
  const { data: stats, loading, error, refresh } = useApi<Stats>('/admin/stats');
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [isPulling, setIsPulling] = useState(false);

  const doRefresh = useCallback(async () => {
    await refresh();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    setLastRefresh(`${hh}:${mm}:${ss}`);
  }, [refresh]);

  const onPullToRefresh = async () => {
    setIsPulling(true);
    await doRefresh();
    setIsPulling(false);
  };

  useRefreshOnForeground(doRefresh);

  useEffect(() => {
    void doRefresh();
    const interval = setInterval(() => void doRefresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [doRefresh]);

  const openJobs = (filter: JobFilter = 'ALL') =>
    router.push({ pathname: '/(tabs)/jobs', params: { filter } });
  const smartSearch = (query: string) => {
    const normalized = query.toLowerCase();
    const id = query.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    )?.[0];
    if (id) return router.push(`/(tabs)/jobs/${id}`);

    // Job filters
    if (normalized.includes('fail')) return openJobs('FAILED');
    if (normalized.includes('queue') || normalized.includes('wait')) return openJobs('QUEUED');
    if (normalized.includes('generat') || normalized.includes('active'))
      return openJobs('GENERATING');
    if (normalized.includes('job')) return openJobs('ALL');

    // Global Navigation
    if (normalized.includes('user') || normalized.includes('account'))
      return router.push('/(tabs)/more/users');
    if (
      normalized.includes('catalog') ||
      normalized.includes('model') ||
      normalized.includes('garment')
    )
      return router.push('/(tabs)/assets/catalog');
    if (normalized.includes('workflow') || normalized.includes('template'))
      return router.push('/(tabs)/more/workflows');
    if (normalized.includes('client') || normalized.includes('widget'))
      return router.push('/(tabs)/more/widget-clients');
    if (normalized.includes('setting') || normalized.includes('config'))
      return router.push('/(tabs)/more/settings');
    if (normalized.includes('worker') || normalized.includes('gpu'))
      return router.push('/(tabs)/more/workers');

    // Fallback
    openJobs('ALL');
  };

  const TAB_BAR_HEIGHT = 72;
  const TAB_BAR_MARGIN = 12;
  const contentStyle = {
    backgroundColor: colors.bg,
    paddingTop: top + Spacing.lg,
    paddingBottom: bottom + TAB_BAR_HEIGHT + TAB_BAR_MARGIN + Spacing.lg,
  };
  if (loading && !stats)
    return (
      <ScrollView contentContainerStyle={[styles.content, contentStyle]}>
        <SkeletonLoader count={4} variant="card" />
        <SkeletonLoader count={3} variant="list" />
      </ScrollView>
    );
  if (error && !stats)
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <MaterialCommunityIcons color={colors.error} name="cloud-off-outline" size={44} />
        <Text style={[styles.errorTitle, { color: colors.text }]}>Dashboard unavailable</Text>
        <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>{error.message}</Text>
        <TouchableOpacity
          onPress={() => void doRefresh()}
          style={[styles.primaryButton, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.buttonLabel, { color: colors.onAccent }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  if (!stats) return null;
  const maxJobs = Math.max(...stats.jobsPerDay, 1);
  const allWorkersOffline = stats.workers.length > 0 && stats.workersHealthy === 0;

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={[styles.content, contentStyle]}
      refreshControl={
        <RefreshControl
          refreshing={isPulling}
          onRefresh={onPullToRefresh}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.hero}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>AI VASTRA ADMIN</Text>
          <Text style={[Typography.display, { color: colors.text }]}>Dashboard</Text>
        </View>
        <View style={styles.heroRight}>
          {lastRefresh ? (
            <View style={[styles.refreshBadge, { backgroundColor: colors.surfaceVariant }]}>
              <Text style={[styles.refreshBadgeText, { color: colors.textMuted }]}>
                {lastRefresh}
              </Text>
            </View>
          ) : null}
          <View style={[styles.livePill, { backgroundColor: colors.successContainer }]}>
            <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.liveText, { color: colors.success }]}>LIVE</Text>
          </View>
        </View>
      </View>
      <SmartSearch onSubmit={smartSearch} />
      {allWorkersOffline ? (
        <View style={[styles.banner, { backgroundColor: colors.errorContainer }]}>
          <MaterialCommunityIcons color={colors.error} name="server-network-off" size={24} />
          <View style={styles.flex}>
            <Text style={[styles.bannerTitle, { color: colors.error }]}>All workers offline</Text>
            <Text style={[styles.bannerCopy, { color: colors.textSecondary }]}>
              Processing is paused until a worker reconnects.
            </Text>
          </View>
        </View>
      ) : null}
      {error ? (
        <Text style={[styles.stale, { color: colors.warning }]}>
          Refresh failed · showing cached operations data
        </Text>
      ) : null}

      <View style={styles.grid}>
        <View style={styles.wide}>
          <StatCard
            featured
            label="Jobs today"
            value={stats.jobsToday}
            delta={stats.jobsTodayDelta}
            onPress={() => openJobs()}
            icon={
              <MaterialCommunityIcons
                color={colors.onAccentContainer}
                name="lightning-bolt"
                size={20}
              />
            }
          />
        </View>
        <View style={styles.half}>
          <StatCard
            label="Credits"
            value={stats.creditsToday}
            delta={stats.creditsTodayDelta}
            icon={
              <MaterialCommunityIcons
                color={colors.accentSecondary}
                name="hexagon-multiple-outline"
                size={19}
              />
            }
          />
        </View>
        <View style={styles.half}>
          <StatCard
            label="Active users"
            value={stats.activeUsersToday}
            delta={stats.activeUsersDelta}
            onPress={() => router.push('/(tabs)/more/users')}
            icon={
              <MaterialCommunityIcons color={colors.info} name="account-group-outline" size={19} />
            }
          />
        </View>
        <View style={styles.half}>
          <StatCard
            label="Workers"
            value={`${stats.workersHealthy}/${stats.workersTotal}`}
            subtitle="Healthy now"
            onPress={() => scrollRef.current?.scrollTo({ y: workersY, animated: true })}
            icon={<MaterialCommunityIcons color={colors.success} name="server-network" size={19} />}
          />
        </View>
        <View style={styles.half}>
          <StatCard
            label="Queue"
            value={stats.queueDepth}
            subtitle="Waiting jobs"
            onPress={() => openJobs('QUEUED')}
            icon={<MaterialCommunityIcons color={colors.warning} name="tray-full" size={19} />}
          />
        </View>
        <View style={styles.wide}>
          <StatCard
            alert={stats.failed24h > 0}
            label="Failed in 24h"
            value={stats.failed24h}
            subtitle={stats.failed24h > 0 ? 'Needs attention' : 'Everything looks healthy'}
            onPress={() => openJobs('FAILED')}
            icon={
              <MaterialCommunityIcons color={colors.error} name="alert-circle-outline" size={20} />
            }
          />
        </View>
      </View>

      <SectionHeader
        title="7-day rhythm"
        subtitle={`${stats.sevenDayTotal} jobs`}
        colors={colors}
      />
      <View
        style={[
          styles.chartCard,
          { backgroundColor: colors.glass, borderColor: colors.border, shadowColor: colors.shadow },
        ]}
      >
        <View style={styles.chart}>
          {stats.jobsPerDay.map((count, index) => (
            <View key={`${stats.jobsPerDayLabels[index] ?? index}`} style={styles.barColumn}>
              <Text style={[styles.barValue, { color: colors.textSecondary }]}>{count}</Text>
              <View style={[styles.barTrack, { backgroundColor: colors.surfaceVariant }]}>
                <View
                  style={[
                    styles.bar,
                    {
                      backgroundColor:
                        index === stats.jobsPerDay.length - 1
                          ? colors.accentSecondary
                          : colors.accent,
                      height: count ? Math.max((count / maxJobs) * 112, 8) : 0,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.barLabel, { color: colors.textMuted }]}>
                {stats.jobsPerDayLabels[index] ?? ''}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View onLayout={(event) => setWorkersY(event.nativeEvent.layout.y)}>
        <SectionHeader
          title="Worker pulse"
          subtitle={`${stats.workersHealthy}/${stats.workersTotal} healthy`}
          colors={colors}
        />
        <View style={styles.list}>
          {stats.workers.length ? (
            stats.workers.map((worker) => <WorkerCard key={worker.id} worker={worker} />)
          ) : (
            <Notice
              title="No workers connected"
              copy="Worker status appears after the first heartbeat."
              colors={colors}
            />
          )}
        </View>
      </View>
      <SectionHeader title="Needs attention" subtitle="Recent failures" colors={colors} />
      <View style={styles.list}>
        {stats.recentFailures.length ? (
          stats.recentFailures.map((failure) => (
            <IssueRow
              key={failure.id}
              title={failure.user}
              detail={failure.error}
              age={failure.age}
              danger
              colors={colors}
              onPress={() => router.push(`/(tabs)/jobs/${failure.id}`)}
            />
          ))
        ) : (
          <Notice
            title="No recent failures"
            copy="Operations are running cleanly."
            colors={colors}
          />
        )}
      </View>
      <SectionHeader title="Stuck queue" subtitle="Manual review" colors={colors} />
      <View style={styles.list}>
        {stats.stuckJobs.length ? (
          stats.stuckJobs.map((job) => (
            <IssueRow
              key={job.id}
              title={job.user}
              detail={`Job #${job.id.slice(0, 8)}`}
              age={job.age}
              colors={colors}
              onPress={() => router.push(`/(tabs)/jobs/${job.id}`)}
            />
          ))
        ) : (
          <Notice title="Queue is clear" copy="No stuck jobs were detected." colors={colors} />
        )}
      </View>
    </ScrollView>
  );
}

type Palette = ReturnType<typeof useAppTheme>['colors'];

function SectionHeader({
  title,
  subtitle,
  colors,
}: {
  title: string;
  subtitle: string;
  colors: Palette;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>{subtitle}</Text>
    </View>
  );
}
function Notice({ title, copy, colors }: { title: string; copy: string; colors: Palette }) {
  return (
    <View style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.noticeTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.noticeCopy, { color: colors.textSecondary }]}>{copy}</Text>
    </View>
  );
}
function IssueRow({
  title,
  detail,
  age,
  danger,
  colors,
  onPress,
}: {
  title: string;
  detail: string;
  age: string;
  danger?: boolean;
  colors: Palette;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.issue, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View
        style={[
          styles.issueIcon,
          { backgroundColor: danger ? colors.errorContainer : colors.warningContainer },
        ]}
      >
        <MaterialCommunityIcons
          color={danger ? colors.error : colors.warning}
          name={danger ? 'alert-outline' : 'timer-sand'}
          size={20}
        />
      </View>
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[styles.issueTitle, { color: colors.text }]}>
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.issueDetail, { color: danger ? colors.error : colors.textSecondary }]}
        >
          {detail}
        </Text>
      </View>
      <Text style={[styles.issueAge, { color: colors.textMuted }]}>{age}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.lg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  flex: { flex: 1 },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  heroRight: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  eyebrow: { ...Typography.label, marginBottom: Spacing.xs },
  refreshBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  refreshBadgeText: { ...Typography.label },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  liveDot: { width: 7, height: 7, borderRadius: Radius.full },
  liveText: { ...Typography.label },
  banner: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.lg, borderRadius: Radius.xl },
  bannerTitle: { ...Typography.bodyBold },
  bannerCopy: { ...Typography.caption, marginTop: 2 },
  stale: { ...Typography.captionBold, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  half: { width: '47%', flexGrow: 1 },
  wide: { width: '100%' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
  sectionTitle: { ...Typography.h2 },
  sectionSubtitle: { ...Typography.captionBold },
  chartCard: {
    height: 198,
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.xl,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 3,
  },
  chart: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  barColumn: { flex: 1, height: '100%', alignItems: 'center', gap: Spacing.xs },
  barValue: { ...Typography.captionBold, fontVariant: ['tabular-nums'] },
  barTrack: {
    width: '68%',
    height: 112,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    borderRadius: Radius.full,
  },
  bar: { width: '100%', borderRadius: Radius.full },
  barLabel: { ...Typography.label, maxWidth: 42 },
  list: { gap: Spacing.sm },
  workerCard: {
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.xl,
    gap: Spacing.md,
  },
  workerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  workerIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  workerDot: { width: 8, height: 8, borderRadius: Radius.full },
  workerName: { ...Typography.bodyBold, flex: 1 },
  workerStatusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  workerStatusLabel: { ...Typography.captionBold },
  workerLastSeen: { ...Typography.caption },
  notice: { padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.lg },
  noticeTitle: { ...Typography.bodyBold },
  noticeCopy: { ...Typography.caption, marginTop: Spacing.xs },
  issue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 74,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  issueIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  issueTitle: { ...Typography.bodyBold },
  issueDetail: { ...Typography.caption },
  issueAge: { ...Typography.captionBold },
  errorTitle: { ...Typography.h2, marginTop: Spacing.lg },
  errorMessage: { ...Typography.body, textAlign: 'center', marginTop: Spacing.sm },
  primaryButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
  },
  buttonLabel: { ...Typography.bodyBold },
});
