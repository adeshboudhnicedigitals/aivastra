import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../../../components/EmptyState';
import {
  type FilterChipOption,
  FilterChips,
  JOB_FILTER_OPTIONS,
  type JobFilter,
} from '../../../components/FilterChips';
import { JobCard } from '../../../components/JobCard';
import { SkeletonLoader } from '../../../components/SkeletonLoader';
import { useRefreshOnForeground } from '../../../hooks/useRefreshOnForeground';
import { useSSE } from '../../../hooks/useSSE';
import { apiFetch } from '../../../lib/api';
import { useAppTheme } from '../../../store/theme';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../styles/tokens';
import type { AdminJobEvent, Job, PaginatedResponse } from '../../../types';

const PAGE_SIZE = 25;
const FALLBACK_POLL_MS = 15_000;

type SortField = 'created' | 'status' | 'credits' | 'priority';
const SORT_OPTIONS: readonly FilterChipOption<SortField>[] = [
  { label: 'Created', value: 'created' },
  { label: 'Status', value: 'status' },
  { label: 'Credits', value: 'credits' },
  { label: 'Priority', value: 'priority' },
];

function isJobFilter(value: string | undefined): value is JobFilter {
  return JOB_FILTER_OPTIONS.some((option) => option.value === value);
}

export default function JobsScreen() {
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const initialFilter = isJobFilter(params.filter) ? params.filter : 'ALL';
  const [filter, setFilter] = useState<JobFilter>(initialFilter);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paginating, setPaginating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [sseDisconnected, setSseDisconnected] = useState(false);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('created');
  const [sortAsc, setSortAsc] = useState(false);
  const requestId = useRef(0);

  const fetchPage = useCallback(
    async (nextPage: number, append = false) => {
      const currentRequest = ++requestId.current;
      const statusQuery = filter === 'ALL' ? '' : `&status=${filter}`;
      const searchQuery = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
      const result = await apiFetch<PaginatedResponse<Job>>(
        `/admin/jobs?page=${nextPage}&pageSize=${PAGE_SIZE}${statusQuery}${searchQuery}`,
      );
      if (currentRequest !== requestId.current) return;
      setJobs((current) => (append ? [...current, ...result.items] : result.items));
      setPage(result.page);
      setTotal(result.total);
      setError(null);
    },
    [filter, search],
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    const startId = requestId.current;
    try {
      await fetchPage(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load jobs'));
    } finally {
      if (requestId.current === startId + 1) {
        setLoading(false);
      }
    }
  }, [fetchPage]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);
  useEffect(() => {
    if (isJobFilter(params.filter)) setFilter(params.filter);
  }, [params.filter]);

  useSSE(
    '/admin/jobs/stream',
    (event) => {
      try {
        const update = JSON.parse(event.data) as AdminJobEvent;
        setSseDisconnected(false);
        const exists = jobs.some((j) => j.id === update.jobId);

        if (!exists) {
          if (filter === 'ALL' || filter === update.status) {
            void fetchPage(1);
          }
        } else {
          setJobs((current) =>
            current.map((job) =>
              job.id === update.jobId
                ? {
                    ...job,
                    status: update.status,
                    workerId: update.workerId ?? job.workerId,
                    errorCode: update.errorCode ?? job.errorCode,
                  }
                : job,
            ),
          );
        }
      } catch {
        /* Ignore malformed stream events. */
      }
    },
    { onError: () => setSseDisconnected(true) },
  );

  useEffect(() => {
    if (!sseDisconnected) return;
    const interval = setInterval(() => void fetchPage(1), FALLBACK_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchPage, sseDisconnected]);

  async function refresh() {
    setRefreshing(true);
    try {
      await fetchPage(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to refresh jobs'));
    } finally {
      setRefreshing(false);
    }
  }

  useRefreshOnForeground(refresh);

  async function loadMore() {
    if (paginating || jobs.length >= total) return;
    setPaginating(true);
    try {
      await fetchPage(page + 1, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load more jobs'));
    } finally {
      setPaginating(false);
    }
  }

  const sortedJobs = [...jobs].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'status':
        cmp = a.status.localeCompare(b.status);
        break;
      case 'credits':
        cmp = a.creditsCharged - b.creditsCharged;
        break;
      case 'priority':
        cmp = (a.priority ? 1 : 0) - (b.priority ? 1 : 0);
        break;
      default:
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    return sortAsc ? cmp : -cmp;
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View
        style={[
          styles.search,
          { backgroundColor: colors.surfaceVariant, borderColor: colors.border },
        ]}
      >
        <MaterialCommunityIcons color={colors.textMuted} name="magnify" size={22} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearch}
          placeholder="Search job ID or user email"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          style={[styles.searchInput, { color: colors.text }]}
          value={search}
        />
        {search ? (
          <TouchableOpacity accessibilityLabel="Clear search" onPress={() => setSearch('')}>
            <MaterialCommunityIcons color={colors.textMuted} name="close-circle" size={20} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.filterRow}>
        <View style={{ flex: 1 }}>
          <FilterChips options={JOB_FILTER_OPTIONS} value={filter} onChange={setFilter} />
        </View>
      </View>

      <View style={styles.sortRow}>
        <FilterChips options={SORT_OPTIONS} value={sortField} onChange={setSortField} />
        <TouchableOpacity
          onPress={() => setSortAsc(!sortAsc)}
          style={[
            styles.sortToggle,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <MaterialCommunityIcons
            color={colors.accent}
            name={sortAsc ? 'sort-ascending' : 'sort-descending'}
            size={18}
          />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingList}>
          <SkeletonLoader count={8} variant="list" />
        </View>
      ) : error && jobs.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.errorTitle, { color: colors.error }]}>Jobs unavailable</Text>
          <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>
            {error.message}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => void loadInitial()}
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: colors.onAccent }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottom + TabBarClearance },
            jobs.length === 0 && styles.emptyList,
          ]}
          data={sortedJobs}
          keyExtractor={(job) => job.id}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) => (
            <JobCard job={item} onPress={() => router.push(`/(tabs)/jobs/${item.id}`)} />
          )}
          ListEmptyComponent={
            <EmptyState title="No jobs found" message="Try another status filter." />
          }
          ListFooterComponent={
            paginating ? <ActivityIndicator color={colors.accent} style={styles.footer} /> : null
          }
          ListHeaderComponent={
            error ? (
              <Text style={[styles.staleWarning, { color: colors.warning }]}>
                Refresh failed. Showing current results.
              </Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: Spacing.md },
  search: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  searchInput: { ...Typography.body, flex: 1 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  sortToggle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
    marginRight: Spacing.lg,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  loadingList: { flex: 1, padding: Spacing.lg },
  list: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxxl },
  emptyList: { flexGrow: 1 },
  errorTitle: { ...Typography.h3 },
  errorMessage: { ...Typography.body, textAlign: 'center', marginTop: Spacing.sm },
  retryButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
  },
  retryLabel: { ...Typography.bodyBold },
  staleWarning: { ...Typography.caption, textAlign: 'center', marginBottom: Spacing.sm },
  footer: { padding: Spacing.lg },
});
