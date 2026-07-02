import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import {
  AssetFormModal,
  type AssetFormValue,
  type AssetGender,
} from '../../../../components/AssetFormModal';
import { AssetsTabBar } from '../../../../components/AssetsTabBar';
import { BackgroundCategoryCard } from '../../../../components/BackgroundCategoryCard';
import { BackgroundCategoryModal } from '../../../../components/BackgroundCategoryModal';
import { confirmAction } from '../../../../components/ConfirmDialog';
import { EmptyState } from '../../../../components/EmptyState';
import { type FilterChipOption, FilterChips } from '../../../../components/FilterChips';
import { SkeletonLoader } from '../../../../components/SkeletonLoader';
import { useApi } from '../../../../hooks/useApi';
import { apiFetch } from '../../../../lib/api';
import { canDeleteAssets } from '../../../../lib/roles';
import { storageUrl } from '../../../../lib/storage';
import { type UploadPhase, uploadTwoImage } from '../../../../lib/upload';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../styles/tokens';
import type { BackgroundCategory, ModelBackground } from '../../../../types';

const FILTERS: readonly FilterChipOption<AssetGender>[] = [
  { label: 'All', value: 'all' },
  { label: 'Men', value: 'men' },
  { label: 'Women', value: 'women' },
  { label: 'Boys', value: 'boys' },
  { label: 'Girls', value: 'girls' },
];

export default function BackgroundsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);
  const { data, loading, error, refresh } = useApi<{ items: ModelBackground[] }>(
    '/admin/assets/backgrounds',
  );
  const [filter, setFilter] = useState<AssetGender>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>(null);
  const [progress, setProgress] = useState(0);

  // Category state
  const [categories, setCategories] = useState<BackgroundCategory[]>([]);
  const [backgroundTypeId, setBackgroundTypeId] = useState<number | null>(null);
  const [catModal, setCatModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<BackgroundCategory | null>(null);
  const [catSaving, setCatSaving] = useState(false);

  const items = (data?.items ?? []).filter(
    (item) => filter === 'all' || item.genderSlug === filter,
  );

  const selectMode = selected.size > 0;
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Compute item counts per category from all backgrounds
  const allBackgrounds = data?.items ?? [];
  const uncategorizedCount = allBackgrounds.filter((bg) => !bg.categoryId).length;
  const categoryCounts = new Map<number, number>();
  allBackgrounds.forEach((bg) => {
    if (bg.categoryId !== null && bg.categoryId !== undefined) {
      categoryCounts.set(bg.categoryId, (categoryCounts.get(bg.categoryId) ?? 0) + 1);
    }
  });

  const filteredCategories = categories.filter(
    (c) =>
      c.typeSlug === 'background' &&
      (filter === 'all' || c.genderSlug === filter || c.genderSlug === null),
  );

  // Fetch categories and type info
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [cats, types] = await Promise.all([
          // /admin/catalog/categories returns every type's categories (no server-side
          // filter) — filter to 'background' client-side, same as the web admin.
          apiFetch<BackgroundCategory[]>('/admin/catalog/categories'),
          apiFetch<{ id: number; slug: string }[]>('/admin/catalog/types'),
        ]);
        if (cancelled) return;
        setCategories(cats.filter((c) => c.typeSlug === 'background'));
        setBackgroundTypeId(types.find((t) => t.slug === 'background')?.id ?? null);
      } catch {
        // non-fatal; categories section just won't show
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function add(value: AssetFormValue) {
    setSubmitting(true);
    try {
      await uploadTwoImage({
        presignEndpoint: '/admin/assets/backgrounds/presign',
        presignBody: { contentType: value.mimeType, thumbnailContentType: 'image/jpeg' },
        fileUri: value.uri,
        contentType: value.mimeType,
        confirmEndpoint: '/admin/assets/backgrounds/confirm',
        confirmBody: (keys) => ({
          ...keys,
          label: value.label,
          genderSlug: value.gender === 'all' ? undefined : value.gender,
          sortOrder: value.sortOrder,
          isWhiteBg: value.isWhiteBg,
        }),
        onProgress: (nextPhase, pct) => {
          setPhase(nextPhase);
          setProgress(pct);
        },
      });
      useToastStore.getState().show('Background added', 'success');
      setModal(false);
      await refresh();
    } catch (cause) {
      Alert.alert('Upload failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSubmitting(false);
      setPhase(null);
      setProgress(0);
    }
  }

  async function bulkDelete() {
    try {
      await apiFetch<{ deleted: number }>('/admin/assets/backgrounds', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [...selected] }),
      });
      useToastStore.getState().show(`${selected.size} backgrounds deleted`, 'success');
      setSelected(new Set());
      await refresh();
    } catch (cause) {
      Alert.alert('Delete failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  async function handleCreateCategory(label: string, isActive: boolean) {
    if (!backgroundTypeId) return;
    setCatSaving(true);
    try {
      const slug = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const cat = await apiFetch<BackgroundCategory>('/admin/catalog/categories', {
        method: 'POST',
        body: JSON.stringify({
          typeId: backgroundTypeId,
          parentId: null,
          slug,
          label,
          isActive,
        }),
      });
      useToastStore.getState().show(`Category "${label}" created`, 'success');
      setCategories((prev) => [...prev, cat]);
      setCatModal(false);
      setEditingCategory(null);
    } catch (cause) {
      Alert.alert('Create failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setCatSaving(false);
    }
  }

  async function handleUpdateCategory(id: number, label: string, isActive: boolean) {
    setCatSaving(true);
    try {
      await apiFetch(`/admin/catalog/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ label, isActive }),
      });
      useToastStore.getState().show('Category updated', 'success');
      setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, label, isActive } : c)));
      setCatModal(false);
      setEditingCategory(null);
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setCatSaving(false);
    }
  }

  async function handleDeleteCategory(cat: BackgroundCategory) {
    try {
      await apiFetch(`/admin/catalog/categories/${cat.id}`, { method: 'DELETE' });
      useToastStore.getState().show(`Category "${cat.label}" deleted`, 'success');
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      setCatModal(false);
      setEditingCategory(null);
    } catch (cause) {
      Alert.alert('Delete failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  function openEditCat(cat: BackgroundCategory) {
    setEditingCategory(cat);
    setCatModal(true);
  }

  if (loading && !data)
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <AssetsTabBar active="backgrounds" />
        <View style={styles.loading}>
          <SkeletonLoader count={6} variant="card" />
        </View>
      </View>
    );

  const hasCategories = filteredCategories.length > 0 || uncategorizedCount > 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <AssetsTabBar active="backgrounds" />
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Backgrounds</Text>
          <Text style={[styles.count, { color: colors.textSecondary }]}>
            {data?.items.length ?? 0} assets
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="New Category"
            onPress={() => {
              setEditingCategory(null);
              setCatModal(true);
            }}
            style={[styles.newCatBtn, { borderColor: colors.accent }]}
          >
            <MaterialCommunityIcons color={colors.accent} name="folder-plus-outline" size={18} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => setModal(true)}
            style={[styles.add, { backgroundColor: colors.accent }]}
          >
            <MaterialCommunityIcons color={colors.onAccent} name="plus" size={20} />
            <Text style={[styles.addLabel, { color: colors.onAccent }]}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FilterChips onChange={setFilter} options={FILTERS} value={filter} />

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
          items.length === 0 && !hasCategories && styles.empty,
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
        ListHeaderComponent={
          hasCategories ? (
            <View style={styles.categorySection}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Categories</Text>
              <View style={styles.categoryGrid}>
                {filteredCategories.map((cat) => (
                  <BackgroundCategoryCard
                    key={cat.id}
                    thumbnailUri={storageUrl(cat.thumbnailKey)}
                    label={cat.label}
                    itemCount={categoryCounts.get(cat.id) ?? 0}
                    isActive={cat.isActive}
                    onPress={() => router.push(`/(tabs)/assets/backgrounds/category/${cat.id}`)}
                    onLongPress={canDeleteAssets(role) ? () => openEditCat(cat) : undefined}
                  />
                ))}
                <BackgroundCategoryCard
                  thumbnailUri={null}
                  label="Uncategorized"
                  itemCount={uncategorizedCount}
                  isActive={true}
                  onPress={() => router.push('/(tabs)/assets/backgrounds/category/0')}
                />
              </View>
              {filteredCategories.length === 0 ? (
                <Text style={[styles.noCat, { color: colors.textSecondary }]}>
                  No categories match this gender filter.
                </Text>
              ) : null}
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>All Backgrounds</Text>
            </View>
          ) : null
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
          <EmptyState
            message="Add a background or choose another gender."
            title="No backgrounds found"
          />
        }
      />

      {selectMode ? (
        <View
          style={[styles.bulk, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.bulkLabel, { color: colors.text }]}>{selected.size} selected</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => setSelected(new Set())}>
            <Text style={[styles.cancel, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => void bulkDelete()}
            style={[styles.delete, { backgroundColor: colors.errorContainer }]}
          >
            <Text style={[styles.deleteLabel, { color: colors.error }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <AssetFormModal
        kind="background"
        onClose={() => setModal(false)}
        onSubmit={(value) => void add(value)}
        phase={phase}
        progress={progress}
        submitting={submitting}
        visible={modal}
      />

      <BackgroundCategoryModal
        visible={catModal}
        category={editingCategory}
        typeId={backgroundTypeId}
        submitting={catSaving}
        onClose={() => {
          setCatModal(false);
          setEditingCategory(null);
        }}
        onSaved={(label, isActive) => {
          if (editingCategory) {
            void handleUpdateCategory(editingCategory.id, label, isActive);
          } else {
            void handleCreateCategory(label, isActive);
          }
        }}
        onDelete={
          canDeleteAssets(role)
            ? (cat) =>
                confirmAction({
                  title: 'Delete category?',
                  message: `Delete "${cat.label}"? Backgrounds inside will become uncategorized.`,
                  confirmLabel: 'Delete',
                  destructive: true,
                  onConfirm: () => void handleDeleteCategory(cat),
                })
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, padding: Spacing.lg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  title: { ...Typography.h1 },
  count: { ...Typography.caption },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  newCatBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: Radius.full,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  addLabel: { ...Typography.bodyBold },
  error: { ...Typography.captionBold, textAlign: 'center', margin: Spacing.sm },
  categorySection: { gap: Spacing.md, marginBottom: Spacing.md },
  sectionTitle: { ...Typography.h3, paddingHorizontal: 0 },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  noCat: { ...Typography.caption, textAlign: 'center' },
  divider: { height: 1, marginVertical: Spacing.sm },
  list: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 120,
    gap: Spacing.md,
  },
  columns: { gap: Spacing.md },
  empty: { flexGrow: 1 },
  bulk: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.xl,
    elevation: 8,
  },
  bulkLabel: { ...Typography.bodyBold, flex: 1 },
  cancel: { ...Typography.bodyBold },
  delete: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.full },
  deleteLabel: { ...Typography.bodyBold },
});
