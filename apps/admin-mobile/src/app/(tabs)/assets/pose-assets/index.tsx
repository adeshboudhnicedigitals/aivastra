import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AssetCard } from '../../../../components/AssetCard';
import { AssetsTabBar } from '../../../../components/AssetsTabBar';
import { confirmAction } from '../../../../components/ConfirmDialog';
import { EmptyState } from '../../../../components/EmptyState';
import { type FilterChipOption, FilterChips } from '../../../../components/FilterChips';
import { PickerModal } from '../../../../components/PickerModal';
import { useApi } from '../../../../hooks/useApi';
import { apiFetch } from '../../../../lib/api';
import { storageUrl } from '../../../../lib/storage';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, Typography } from '../../../../styles/tokens';
import type { ModelPoseAsset, WorkflowOption } from '../../../../types';

type GenderFilter = 'all' | 'men' | 'women' | 'boys' | 'girls';
const GENDER_FILTERS: readonly FilterChipOption<GenderFilter>[] = [
  { label: 'All', value: 'all' },
  { label: 'Men', value: 'men' },
  { label: 'Women', value: 'women' },
  { label: 'Boys', value: 'boys' },
  { label: 'Girls', value: 'girls' },
];

type SortField = 'sortOrder' | 'name' | 'date';
const SORT_OPTIONS: readonly FilterChipOption<SortField>[] = [
  { label: 'Sort Order', value: 'sortOrder' },
  { label: 'Name', value: 'name' },
  { label: 'Date Added', value: 'date' },
];

function hasActiveFilters(search: string, workflow: string, variant: string): boolean {
  return !!(search || workflow || variant);
}

export default function Screen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const { data, loading, error, refresh } = useApi<{ items: ModelPoseAsset[] }>(
    '/admin/assets/pose-assets',
  );
  const workflows = useApi<WorkflowOption[]>('/admin/workflows');

  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [search, setSearch] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [variantFilter, setVariantFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('sortOrder');
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [workflowPickerVisible, setWorkflowPickerVisible] = useState(false);
  const [workflowPickerMode, setWorkflowPickerMode] = useState<'filter' | 'bulk'>('filter');
  const [variantPickerVisible, setVariantPickerVisible] = useState(false);
  const [bulkMode, setBulkMode] = useState<'rename' | 'sort' | null>(null);
  const [bulkInput, setBulkInput] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const allItems = data?.items ?? [];
  const workflowOptions = workflows.data ?? [];
  const variantOptions = useMemo(
    () => [...new Set(allItems.map((x) => x.poseVariant).filter(Boolean) as string[])].sort(),
    [allItems],
  );

  const filtered = useMemo(() => {
    let result = allItems.filter((x) => genderFilter === 'all' || x.genderSlug === genderFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (x) => x.label.toLowerCase().includes(q) || (x.displayName ?? '').toLowerCase().includes(q),
      );
    }
    if (workflowFilter) {
      result = result.filter((x) => x.workflowTemplateId === workflowFilter);
    }
    if (variantFilter) {
      result = result.filter((x) => x.poseVariant === variantFilter);
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = (a.displayName ?? a.label).localeCompare(b.displayName ?? b.label);
          break;
        case 'date':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        default:
          cmp = a.sortOrder - b.sortOrder;
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [allItems, genderFilter, search, workflowFilter, variantFilter, sortField, sortAsc]);

  const toggle = (id: string) =>
    setSelected((c) => {
      const n = new Set(c);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  function selectAll() {
    setSelected(new Set(filtered.map((x) => x.id)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  async function bulkDelete() {
    confirmAction({
      title: `Delete ${selected.size} pose assets?`,
      message: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await apiFetch('/admin/assets/pose-assets', {
            method: 'DELETE',
            body: JSON.stringify({ ids: [...selected] }),
          });
          useToastStore.getState().show(`${selected.size} pose assets deleted`, 'success');
          setSelected(new Set());
          await refresh();
        } catch (c) {
          Alert.alert('Delete failed', c instanceof Error ? c.message : 'Please try again.');
        }
      },
    });
  }

  async function submitBulk() {
    const trimmed = bulkInput.trim();
    if (!trimmed) return;
    setBulkSubmitting(true);
    try {
      if (bulkMode === 'rename') {
        await apiFetch('/admin/assets/pose-assets/bulk-rename', {
          method: 'PATCH',
          body: JSON.stringify({ ids: [...selected], displayName: trimmed }),
        });
        useToastStore.getState().show(`Renamed ${selected.size} assets`, 'success');
      } else if (bulkMode === 'sort') {
        const start = parseInt(trimmed, 10);
        if (isNaN(start)) {
          Alert.alert('Invalid number', 'Please enter a valid starting sort order.');
          setBulkSubmitting(false);
          return;
        }
        await Promise.all(
          [...selected].map((selectedId, i) =>
            apiFetch(`/admin/assets/pose-assets/${selectedId}`, {
              method: 'PATCH',
              body: JSON.stringify({ sortOrder: start + i }),
            }),
          ),
        );
        useToastStore.getState().show(`Sort order updated for ${selected.size} assets`, 'success');
      }
      setBulkMode(null);
      setBulkInput('');
      setSelected(new Set());
      await refresh();
    } catch (c) {
      Alert.alert('Failed', c instanceof Error ? c.message : 'Please try again.');
    } finally {
      setBulkSubmitting(false);
    }
  }

  function clearFilters() {
    setSearch('');
    setWorkflowFilter('');
    setVariantFilter('');
    setGenderFilter('all');
    setSortField('sortOrder');
    setSortAsc(true);
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <AssetsTabBar active="pose-assets" />
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Pose Assets</Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => router.push('/(tabs)/assets/pose-assets/add')}
          style={[styles.add, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.addText, { color: colors.onAccent }]}>Add</Text>
        </TouchableOpacity>
      </View>

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
          placeholder="Search label or display name"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          style={[styles.searchInput, { color: colors.text }]}
          value={search}
        />
        {search ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setSearch('')}
          >
            <MaterialCommunityIcons color={colors.textMuted} name="close-circle" size={20} />
          </TouchableOpacity>
        ) : null}
      </View>

      <FilterChips options={GENDER_FILTERS} value={genderFilter} onChange={setGenderFilter} />

      <View style={styles.filterRow}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => {
            setWorkflowPickerMode('filter');
            setWorkflowPickerVisible(true);
          }}
          style={[
            styles.pickerButton,
            {
              backgroundColor: colors.surface,
              borderColor: workflowFilter ? colors.accent : colors.border,
            },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.pickerText,
              { color: workflowFilter ? colors.accent : colors.textSecondary },
            ]}
          >
            {workflowFilter
              ? (workflowOptions.find((w) => w.id === workflowFilter)?.label ?? 'Workflow')
              : 'Workflow'}
          </Text>
          <MaterialCommunityIcons color={colors.textMuted} name="chevron-down" size={18} />
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setVariantPickerVisible(true)}
          style={[
            styles.pickerButton,
            {
              backgroundColor: colors.surface,
              borderColor: variantFilter ? colors.accent : colors.border,
            },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.pickerText,
              { color: variantFilter ? colors.accent : colors.textSecondary },
            ]}
          >
            {variantFilter || 'Pose Variant'}
          </Text>
          <MaterialCommunityIcons color={colors.textMuted} name="chevron-down" size={18} />
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
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

      <FilterChips options={SORT_OPTIONS} value={sortField} onChange={setSortField} />

      {hasActiveFilters(search, workflowFilter, variantFilter) ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={clearFilters}
          style={styles.clearFilters}
        >
          <MaterialCommunityIcons color={colors.error} name="filter-remove" size={16} />
          <Text style={[styles.clearFiltersText, { color: colors.error }]}>Clear filters</Text>
        </TouchableOpacity>
      ) : null}

      {error ? (
        <Text style={[styles.errorText, { color: colors.warning }]}>Refresh failed.</Text>
      ) : null}

      <View style={styles.selectRow}>
        {filtered.length > 0 ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={selected.size === filtered.length ? deselectAll : selectAll}
            style={[
              styles.selectAllBtn,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.selectAllText, { color: colors.accent }]}>
              {selected.size === filtered.length ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>
        ) : null}
        {selected.size > 0 ? (
          <Text style={[styles.selectedCount, { color: colors.textSecondary }]}>
            {selected.size} selected
          </Text>
        ) : null}
      </View>

      <FlatList
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 160 }]}
        data={filtered}
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
            label={item.displayName ?? item.label}
            isActive
            onLongPress={() => toggle(item.id)}
            selected={selected.has(item.id)}
            onPress={() =>
              selected.size ? toggle(item.id) : router.push(`/(tabs)/assets/pose-assets/${item.id}`)
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState title="No pose assets" message="Create a reusable pose asset." />
        }
      />

      {selected.size ? (
        <View style={[styles.bulk, { backgroundColor: colors.surface }]}>
          <View style={styles.bulkActions}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setBulkMode('rename');
                setBulkInput('');
              }}
              style={styles.bulkBtn}
            >
              <MaterialCommunityIcons color={colors.accent} name="rename-box" size={18} />
              <Text style={[styles.bulkBtnText, { color: colors.accent }]}>Rename</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setWorkflowPickerMode('bulk');
                setWorkflowPickerVisible(true);
              }}
              style={styles.bulkBtn}
            >
              <MaterialCommunityIcons color={colors.accent} name="swap-horizontal" size={18} />
              <Text style={[styles.bulkBtnText, { color: colors.accent }]}>Workflow</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setBulkMode('sort');
                setBulkInput('0');
              }}
              style={styles.bulkBtn}
            >
              <MaterialCommunityIcons
                color={colors.accent}
                name="sort-numeric-ascending"
                size={18}
              />
              <Text style={[styles.bulkBtnText, { color: colors.accent }]}>Sort</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={bulkDelete}
              style={styles.bulkBtn}
            >
              <MaterialCommunityIcons color={colors.error} name="delete-outline" size={18} />
              <Text style={[styles.bulkBtnText, { color: colors.error }]}>Delete</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.bulkFooter}>
            <Text style={[styles.bulkText, { color: colors.text }]}>{selected.size} selected</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => setSelected(new Set())}>
              <Text style={{ color: colors.textSecondary }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setBulkMode(null)}
        transparent
        visible={bulkMode !== null}
      >
        <View style={styles.promptOverlay}>
          <View
            style={[
              styles.promptCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.promptTitle, { color: colors.text }]}>
              {bulkMode === 'rename' ? 'Bulk Rename' : 'Bulk Sort Order'}
            </Text>
            <Text style={[styles.promptHint, { color: colors.textSecondary }]}>
              {bulkMode === 'rename'
                ? 'Set a new display name for all selected assets.'
                : 'Enter the starting sort order number.'}
            </Text>
            <TextInput
              autoFocus
              keyboardType={bulkMode === 'sort' ? 'number-pad' : 'default'}
              onChangeText={setBulkInput}
              onSubmitEditing={() => void submitBulk()}
              placeholder={bulkMode === 'rename' ? 'Display name' : 'Start value'}
              placeholderTextColor={colors.textMuted}
              returnKeyType="done"
              style={[
                styles.promptInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceVariant,
                },
              ]}
              value={bulkInput}
            />
            <View style={styles.promptActions}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => {
                  setBulkMode(null);
                  setBulkInput('');
                }}
                style={[styles.promptBtn, { backgroundColor: colors.surfaceVariant }]}
              >
                <Text style={[styles.promptBtnText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={bulkSubmitting || !bulkInput.trim()}
                onPress={() => void submitBulk()}
                style={[
                  styles.promptBtn,
                  { backgroundColor: colors.accent },
                  (bulkSubmitting || !bulkInput.trim()) && { opacity: 0.5 },
                ]}
              >
                <Text style={[styles.promptBtnText, { color: colors.onAccent }]}>
                  {bulkSubmitting ? 'Saving…' : 'Apply'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <PickerModal
        visible={workflowPickerVisible}
        title={
          workflowPickerMode === 'bulk' && selected.size
            ? 'Bulk Change Workflow'
            : 'Select workflow'
        }
        options={[
          ...(workflowPickerMode === 'bulk' ? [] : [{ id: '', label: 'All workflows' }]),
          ...workflowOptions.map((w) => ({ id: w.id, label: w.label, subtitle: w.slug })),
        ]}
        onClose={() => setWorkflowPickerVisible(false)}
        onSelect={(selectedId) => {
          if (workflowPickerMode === 'bulk' && selected.size) {
            void (async () => {
              try {
                await apiFetch('/admin/assets/pose-assets/bulk-workflow', {
                  method: 'PATCH',
                  body: JSON.stringify({
                    ids: [...selected],
                    workflowTemplateId: selectedId,
                  }),
                });
                useToastStore
                  .getState()
                  .show(`Workflow updated for ${selected.size} assets`, 'success');
                setSelected(new Set());
                await refresh();
              } catch (c) {
                Alert.alert('Failed', c instanceof Error ? c.message : 'Please try again.');
              }
            })();
            setWorkflowPickerVisible(false);
          } else {
            setWorkflowFilter(selectedId);
            setWorkflowPickerVisible(false);
          }
        }}
      />

      <PickerModal
        visible={variantPickerVisible}
        title="Select pose variant"
        options={[
          { id: '', label: 'All variants' },
          ...variantOptions.map((v) => ({ id: v, label: v })),
        ]}
        onClose={() => setVariantPickerVisible(false)}
        onSelect={(selectedId) => {
          setVariantFilter(selectedId);
          setVariantPickerVisible(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  title: { ...Typography.h1 },
  add: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, borderRadius: Radius.full },
  addText: { ...Typography.bodyBold },
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
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  pickerButton: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  pickerText: { ...Typography.caption, flex: 1 },
  sortToggle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  clearFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  clearFiltersText: { ...Typography.captionBold },
  errorText: { ...Typography.captionBold, textAlign: 'center' },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  selectAllBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  selectAllText: { ...Typography.captionBold },
  selectedCount: { ...Typography.caption },
  list: { padding: Spacing.lg, gap: Spacing.md },
  columns: { gap: Spacing.md },
  bulk: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: 92,
    borderRadius: Radius.xl,
    elevation: 8,
    overflow: 'hidden',
  },
  bulkActions: {
    flexDirection: 'row',
    gap: Spacing.xs,
    padding: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  bulkBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  bulkBtnText: { ...Typography.label, fontSize: 10 },
  bulkFooter: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  bulkText: { ...Typography.bodyBold, flex: 1 },
  promptOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: Spacing.xl,
  },
  promptCard: {
    width: '100%',
    maxWidth: 360,
    padding: Spacing.xl,
    borderWidth: 1,
    borderRadius: Radius.xl,
    gap: Spacing.md,
  },
  promptTitle: { ...Typography.h3 },
  promptHint: { ...Typography.caption },
  promptInput: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    ...Typography.body,
  },
  promptActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'flex-end',
    marginTop: Spacing.sm,
  },
  promptBtn: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  promptBtnText: { ...Typography.bodyBold },
});
