import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AssetCard } from '../../../../../components/AssetCard';
import { confirmAction } from '../../../../../components/ConfirmDialog';
import { EmptyState } from '../../../../../components/EmptyState';
import { type FilterChipOption, FilterChips } from '../../../../../components/FilterChips';
import { PickerModal, type PickerOption } from '../../../../../components/PickerModal';
import { SkeletonLoader } from '../../../../../components/SkeletonLoader';
import { useApi } from '../../../../../hooks/useApi';
import { apiFetch } from '../../../../../lib/api';
import { canDeleteAssets } from '../../../../../lib/roles';
import { storageUrl } from '../../../../../lib/storage';
import { useAuthStore } from '../../../../../store/auth';
import { useAppTheme } from '../../../../../store/theme';
import { useToastStore } from '../../../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../../styles/tokens';
import type { BackgroundCategory, ModelBackground } from '../../../../../types';

type Gender = 'all' | 'men' | 'women' | 'boys' | 'girls';

const GENDERS: readonly FilterChipOption<Gender>[] = [
  { label: 'All', value: 'all' },
  { label: 'Men', value: 'men' },
  { label: 'Women', value: 'women' },
  { label: 'Boys', value: 'boys' },
  { label: 'Girls', value: 'girls' },
];

const BULK_GENDER_OPTIONS: readonly PickerOption[] = [
  { id: 'all', label: 'All Gender' },
  { id: 'men', label: 'Men' },
  { id: 'women', label: 'Women' },
  { id: 'boys', label: 'Boys' },
  { id: 'girls', label: 'Girls' },
];

export default function CategoryBackgroundsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);
  const isUncategorized = id === '0' || id === 'uncategorized';
  const numericId = isUncategorized ? null : Number(id);

  const path = isUncategorized
    ? '/admin/assets/backgrounds?uncategorized=true'
    : `/admin/assets/backgrounds?categoryId=${numericId}`;

  const { data, loading, error, refresh } = useApi<{ items: ModelBackground[] }>(path);

  // /admin/catalog/categories returns every type's categories (no server-side filter) —
  // filter to 'background' client-side, same as the web admin.
  const { data: catData } = useApi<BackgroundCategory[]>('/admin/catalog/categories');
  const categories = (catData ?? []).filter((c) => c.typeSlug === 'background');
  const currentCat = isUncategorized ? null : categories.find((c) => c.id === numericId);
  const displayLabel = currentCat?.label ?? 'Uncategorized';

  const [filter, setFilter] = useState<Gender>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [showGenderPicker, setShowGenderPicker] = useState(false);

  const items = (data?.items ?? []).filter(
    (item) => filter === 'all' || item.genderSlug === filter,
  );

  const categoryPickerOptions: PickerOption[] = [
    { id: 'uncategorized', label: 'Uncategorized' },
    ...categories.map((c) => ({ id: String(c.id), label: c.label })),
  ];

  const selectMode = selected.size > 0;
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function bulkChangeCategory(categoryId: string) {
    const ids = [...selected];
    setBulkSaving(true);
    setShowCatPicker(false);
    try {
      await apiFetch('/admin/assets/backgrounds/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          ids,
          categoryId: categoryId === 'uncategorized' ? null : Number(categoryId),
        }),
      });
      useToastStore
        .getState()
        .show(`${ids.length} background${ids.length !== 1 ? 's' : ''} moved`, 'success');
      setSelected(new Set());
      await refresh();
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setBulkSaving(false);
    }
  }

  async function bulkChangeGender(genderId: string) {
    const ids = [...selected];
    const genderSlug = genderId === 'all' ? null : genderId;
    setBulkSaving(true);
    setShowGenderPicker(false);
    try {
      await apiFetch('/admin/assets/backgrounds/bulk', {
        method: 'PATCH',
        body: JSON.stringify({ ids, genderSlug }),
      });
      useToastStore
        .getState()
        .show(`${ids.length} background${ids.length !== 1 ? 's' : ''} updated`, 'success');
      setSelected(new Set());
      await refresh();
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setBulkSaving(false);
    }
  }

  async function bulkDelete() {
    const ids = [...selected];
    try {
      await apiFetch<{ deleted: number }>('/admin/assets/backgrounds', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      useToastStore
        .getState()
        .show(`${ids.length} background${ids.length !== 1 ? 's' : ''} deleted`, 'success');
      setSelected(new Set());
      await refresh();
    } catch (cause) {
      Alert.alert('Delete failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  if (loading && !data)
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        <SkeletonLoader count={6} variant="card" />
      </View>
    );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <MaterialCommunityIcons color={colors.accent} name="chevron-left" size={28} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.title, { color: colors.text }]}>{displayLabel}</Text>
          <Text style={[styles.count, { color: colors.textSecondary }]}>
            {items.length} asset{items.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <View style={{ width: 28 }} />
      </View>

      <FilterChips onChange={setFilter} options={GENDERS} value={filter} />

      {error ? (
        <Text style={[styles.error, { color: colors.warning }]}>
          Refresh failed. Showing current assets.
        </Text>
      ) : null}

      <FlatList
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottom + TabBarClearance },
          items.length === 0 && styles.empty,
        ]}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <AssetCard
            isActive={item.isActive}
            label={item.label}
            specialTag={item.specialTag}
            onLongPress={canDeleteAssets(role) ? () => toggle(item.id) : undefined}
            onPress={() =>
              selectMode ? toggle(item.id) : router.push(`/(tabs)/assets/backgrounds/${item.id}`)
            }
            selected={selected.has(item.id)}
            thumbnailUri={storageUrl(item.thumbnailKey)}
          />
        )}
        ListEmptyComponent={
          <EmptyState message="No backgrounds in this category yet." title="Empty category" />
        }
      />

      {selectMode ? (
        <View
          style={[styles.bulk, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.bulkLabel, { color: colors.text }]}>{selected.size} selected</Text>
          <TouchableOpacity onPress={() => setSelected(new Set())}>
            <Text style={[styles.cancel, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={bulkSaving}
            onPress={() => setShowCatPicker(true)}
            style={[styles.bulkBtn, { borderColor: colors.border }]}
          >
            {bulkSaving ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Text style={[styles.bulkBtnLabel, { color: colors.accent }]}>Category</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            disabled={bulkSaving}
            onPress={() => setShowGenderPicker(true)}
            style={[styles.bulkBtn, { borderColor: colors.border }]}
          >
            {bulkSaving ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Text style={[styles.bulkBtnLabel, { color: colors.accent }]}>Gender</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              confirmAction({
                title: `Delete ${selected.size} background${selected.size !== 1 ? 's' : ''}?`,
                message: 'These backgrounds will move to the recycle bin.',
                confirmLabel: 'Delete',
                destructive: true,
                onConfirm: () => void bulkDelete(),
              })
            }
            style={[styles.delete, { backgroundColor: colors.errorContainer }]}
          >
            <Text style={[styles.deleteLabel, { color: colors.error }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <PickerModal
        visible={showCatPicker}
        title="Change Category"
        options={categoryPickerOptions}
        onClose={() => setShowCatPicker(false)}
        onSelect={(catId) => void bulkChangeCategory(catId)}
      />

      <PickerModal
        visible={showGenderPicker}
        title="Change Gender"
        options={[...BULK_GENDER_OPTIONS]}
        onClose={() => setShowGenderPicker(false)}
        onSelect={(genderId) => void bulkChangeGender(genderId)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 54 },
  loading: { flex: 1, padding: Spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  back: { padding: 4 },
  headerInfo: { flex: 1 },
  title: { ...Typography.h1 },
  count: { ...Typography.caption },
  error: { ...Typography.captionBold, textAlign: 'center', margin: Spacing.sm },
  list: { padding: Spacing.lg, paddingBottom: 120, gap: Spacing.md },
  columns: { gap: Spacing.md },
  empty: { flexGrow: 1 },
  bulk: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.xl,
    elevation: 8,
  },
  bulkLabel: { ...Typography.bodyBold, flex: 1 },
  cancel: { ...Typography.captionBold },
  bulkBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
    minHeight: 32,
    justifyContent: 'center',
  },
  bulkBtnLabel: { ...Typography.captionBold },
  delete: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full },
  deleteLabel: { ...Typography.captionBold },
});
