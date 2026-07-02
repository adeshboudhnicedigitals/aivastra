import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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
import {
  AssetFormModal,
  type AssetFormValue,
  type AssetGender,
} from '../../../../components/AssetFormModal';
import { AssetsTabBar } from '../../../../components/AssetsTabBar';
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
import type { ModelFace } from '../../../../types';

const FILTERS: readonly FilterChipOption<AssetGender>[] = [
  { label: 'All', value: 'all' },
  { label: 'Men', value: 'men' },
  { label: 'Women', value: 'women' },
  { label: 'Boys', value: 'boys' },
  { label: 'Girls', value: 'girls' },
];
export default function FacesScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);
  const { data, loading, error, refresh } = useApi<{ items: ModelFace[] }>('/admin/assets/faces');
  const [filter, setFilter] = useState<AssetGender>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>(null);
  const [progress, setProgress] = useState(0);
  const items = (data?.items ?? []).filter((item) => filter === 'all' || item.gender === filter);
  const selectMode = selected.size > 0;
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  async function add(value: AssetFormValue) {
    setSubmitting(true);
    try {
      await uploadTwoImage({
        presignEndpoint: '/admin/assets/faces/presign',
        presignBody: { contentType: value.mimeType },
        fileUri: value.uri,
        contentType: value.mimeType,
        confirmEndpoint: '/admin/assets/faces/confirm',
        confirmBody: (keys) => ({
          ...keys,
          label: value.label,
          gender: value.gender,
          sortOrder: value.sortOrder,
        }),
        onProgress: (nextPhase, pct) => {
          setPhase(nextPhase);
          setProgress(pct);
        },
      });
      useToastStore.getState().show('Face added', 'success');
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
      await apiFetch<{ deleted: number }>('/admin/assets/faces', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [...selected] }),
      });
      useToastStore.getState().show(`${selected.size} faces deleted`, 'success');
      setSelected(new Set());
      await refresh();
    } catch (cause) {
      Alert.alert('Delete failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }
  if (loading && !data)
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <AssetsTabBar active="faces" />
        <View style={styles.loading}>
          <SkeletonLoader count={6} variant="card" />
        </View>
      </View>
    );
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <AssetsTabBar active="faces" />
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Faces</Text>
          <Text style={[styles.count, { color: colors.textSecondary }]}>
            {data?.items.length ?? 0} assets
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setModal(true)}
          style={[styles.add, { backgroundColor: colors.accent }]}
        >
          <MaterialCommunityIcons color={colors.onAccent} name="plus" size={20} />
          <Text style={[styles.addLabel, { color: colors.onAccent }]}>Add</Text>
        </TouchableOpacity>
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
            onLongPress={canDeleteAssets(role) ? () => toggle(item.id) : undefined}
            onPress={() =>
              selectMode ? toggle(item.id) : router.push(`/(tabs)/assets/faces/${item.id}`)
            }
            selected={selected.has(item.id)}
            thumbnailUri={storageUrl(item.thumbnailKey)}
          />
        )}
        ListEmptyComponent={
          <EmptyState message="Add a face or choose another gender." title="No faces found" />
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
        kind="face"
        onClose={() => setModal(false)}
        onSubmit={(value) => void add(value)}
        phase={phase}
        progress={progress}
        submitting={submitting}
        visible={modal}
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
