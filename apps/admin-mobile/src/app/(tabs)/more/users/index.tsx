import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { EmptyState } from '../../../../components/EmptyState';
import { SkeletonLoader } from '../../../../components/SkeletonLoader';
import { UserRow } from '../../../../components/UserRow';
import { usePagination } from '../../../../hooks/usePagination';
import { apiFetch } from '../../../../lib/api';
import { useAppTheme } from '../../../../store/theme';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../styles/tokens';
import type { PaginatedResponse, User } from '../../../../types';

const PAGE_SIZE = 20;

export default function UsersScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => {
      if (mounted) setDebouncedSearch(search.trim());
    }, 400);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [search]);
  const fetchPage = useCallback(
    (page: number) =>
      apiFetch<PaginatedResponse<User>>(
        `/admin/users?page=${page}&pageSize=${PAGE_SIZE}&search=${encodeURIComponent(debouncedSearch)}`,
      ),
    [debouncedSearch],
  );
  const { items, loading, refreshing, paginating, error, refresh, loadMore } =
    usePagination(fetchPage);

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
          placeholder="Search email or display name"
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
          <Text style={[styles.errorTitle, { color: colors.error }]}>Users unavailable</Text>
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
          keyExtractor={(item) => item.id}
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
            <UserRow onPress={() => router.push(`/(tabs)/more/users/${item.id}`)} user={item} />
          )}
          ListEmptyComponent={
            <EmptyState message="Try a different search term" title="No users found" />
          }
          ListFooterComponent={
            paginating ? <ActivityIndicator color={colors.accent} style={styles.footer} /> : null
          }
          ListHeaderComponent={
            error ? (
              <Text style={[styles.stale, { color: colors.warning }]}>
                Refresh failed. Showing current users.
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
  footer: { padding: Spacing.lg },
  stale: { ...Typography.captionBold, textAlign: 'center', marginBottom: Spacing.sm },
});
