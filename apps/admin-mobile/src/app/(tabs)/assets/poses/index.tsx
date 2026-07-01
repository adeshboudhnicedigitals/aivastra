import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AssetCard } from '../../../../components/AssetCard';
import { EmptyState } from '../../../../components/EmptyState';
import { type FilterChipOption, FilterChips } from '../../../../components/FilterChips';
import { useApi } from '../../../../hooks/useApi';
import { apiFetch } from '../../../../lib/api';
import { canDeleteAssets } from '../../../../lib/roles';
import { storageUrl } from '../../../../lib/storage';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, Typography } from '../../../../styles/tokens';
import type { ModelPose } from '../../../../types';

type Filter = 'all' | 'active' | 'inactive';
const FILTERS: readonly FilterChipOption<Filter>[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
];
export default function Screen() {
  const { garmentTypeId } = useLocalSearchParams<{ garmentTypeId: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((s) => s.role);
  const { data, loading, error, refresh } = useApi<{ items: ModelPose[] }>(
    `/admin/assets/poses?garmentTypeId=${garmentTypeId}`,
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const items = (data?.items ?? []).filter(
    (x) => filter === 'all' || (filter === 'active' ? x.isActive : !x.isActive),
  );
  const toggle = (id: string) =>
    setSelected((cur) => {
      const n = new Set(cur);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  async function remove() {
    try {
      await apiFetch('/admin/assets/poses', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [...selected] }),
      });
      useToastStore.getState().show(`${selected.size} poses deleted`, 'success');
      setSelected(new Set());
      await refresh();
    } catch (c) {
      Alert.alert('Delete failed', c instanceof Error ? c.message : 'Please try again.');
    }
  }
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.text }]}>Poses</Text>
      <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
      {error ? <Text style={{ color: colors.warning }}>Refresh failed.</Text> : null}
      <FlatList
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 100 }]}
        data={items}
        numColumns={2}
        keyExtractor={(x) => x.id}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <AssetCard
            thumbnailUri={storageUrl(item.thumbnailKey)}
            label={item.label}
            isActive={item.isActive}
            selected={selected.has(item.id)}
            onLongPress={canDeleteAssets(role) ? () => toggle(item.id) : undefined}
            onPress={() =>
              selected.size
                ? toggle(item.id)
                : router.push(`/(tabs)/assets/poses/${item.id}?garmentTypeId=${garmentTypeId}`)
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState title="No poses" message="No poses are mapped to this garment type." />
        }
      />
      {selected.size ? (
        <View style={[styles.bulk, { backgroundColor: colors.surface }]}>
          <Text style={[styles.bulkText, { color: colors.text }]}>{selected.size} selected</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => setSelected(new Set())}>
            <Text style={{ color: colors.textSecondary }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => void remove()}>
            <Text style={{ color: colors.error }}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 54 },
  title: { ...Typography.h1, paddingHorizontal: Spacing.lg, marginBottom: Spacing.lg },
  list: { padding: Spacing.lg, gap: Spacing.md },
  columns: { gap: Spacing.md },
  bulk: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: 92,
    flexDirection: 'row',
    gap: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: Radius.xl,
    elevation: 8,
  },
  bulkText: { ...Typography.bodyBold, flex: 1 },
});
