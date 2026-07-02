import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../../../../components/EmptyState';
import { SkeletonLoader } from '../../../../components/SkeletonLoader';
import { usePagination } from '../../../../hooks/usePagination';
import { apiFetch } from '../../../../lib/api';
import { canAccessAssets } from '../../../../lib/roles';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../styles/tokens';
import type { PaginatedResponse, WidgetClient, WidgetClientsResponse } from '../../../../types';

const PAGE_SIZE = 20;

function ClientRow({ client, onPress }: { client: WidgetClient; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.rowLeft}>
        <Text numberOfLines={1} style={[styles.rowName, { color: colors.text }]}>
          {client.companyName}
        </Text>
        <Text numberOfLines={1} style={[styles.rowEmail, { color: colors.textSecondary }]}>
          {client.email}
        </Text>
        <View style={styles.keyRow}>
          <Text style={[styles.rowKey, { color: colors.textMuted }]}>
            {client.widgetKey.slice(0, 8)}...
          </Text>
          <TouchableOpacity
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => {
              Alert.alert('Widget Key', client.widgetKey);
            }}
          >
            <MaterialCommunityIcons color={colors.accent} name="content-copy" size={14} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowCredits, { color: colors.accent }]}>
          {client.creditBalance ?? 0} credits
        </Text>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: client.isActive ? colors.successContainer : colors.errorContainer,
            },
          ]}
        >
          <Text
            style={[styles.badgeText, { color: client.isActive ? colors.success : colors.error }]}
          >
            {client.isActive ? 'Active' : 'Inactive'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function WidgetClientsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(
    async (page: number) => {
      const res = await apiFetch<WidgetClientsResponse>(
        `/v1/admin/widget-clients?page=${page}&limit=${PAGE_SIZE}&search=${encodeURIComponent(debouncedSearch)}`,
      );
      return {
        items: res.clients,
        total: res.total,
        page: res.page,
        pageSize: res.limit,
      } satisfies PaginatedResponse<WidgetClient>;
    },
    [debouncedSearch],
  );

  const { items, loading, refreshing, paginating, error, refresh, loadMore } =
    usePagination(fetchPage);

  if (!canAccessAssets(role)) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <EmptyState
          message="You need ADMIN or SUPER_ADMIN access to view widget clients."
          title="Access denied"
        />
      </View>
    );
  }

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
          placeholder="Search company or email"
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

      {loading ? (
        <View style={styles.loading}>
          <SkeletonLoader count={8} variant="list" />
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.error}>
          <Text style={[styles.errorTitle, { color: colors.error }]}>
            Widget clients unavailable
          </Text>
          <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>
            {error.message}
          </Text>
          <TouchableOpacity
            onPress={() => void refresh()}
            style={[styles.retry, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: colors.onAccent }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottom + TabBarClearance },
            items.length === 0 && styles.empty,
          ]}
          data={items}
          keyExtractor={(item: WidgetClient) => item.id}
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
            <ClientRow
              client={item}
              onPress={() => router.push(`/(tabs)/more/widget-clients/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            <EmptyState message="Try a different search term" title="No widget clients found" />
          }
          ListFooterComponent={
            paginating ? <ActivityIndicator color={colors.accent} style={styles.footer} /> : null
          }
          ListHeaderComponent={
            error ? (
              <Text style={[styles.stale, { color: colors.warning }]}>
                Refresh failed. Showing current clients.
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
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  searchInput: { ...Typography.body, flex: 1 },
  loading: { flex: 1, padding: Spacing.lg },
  list: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxxl },
  empty: { flexGrow: 1 },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  errorTitle: { ...Typography.h3 },
  errorMessage: { ...Typography.body, textAlign: 'center', marginTop: Spacing.sm },
  retry: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    marginTop: Spacing.lg,
  },
  retryLabel: { ...Typography.bodyBold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 72,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  rowLeft: { flex: 1, gap: 2 },
  rowName: { ...Typography.bodyBold },
  rowEmail: { ...Typography.caption },
  rowKey: { ...Typography.caption, fontFamily: 'monospace', marginTop: 2 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  rowCredits: { ...Typography.captionBold },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  badgeText: { ...Typography.captionBold, fontSize: 10 },
  footer: { padding: Spacing.lg },
  stale: { ...Typography.captionBold, textAlign: 'center', marginBottom: Spacing.sm },
});
