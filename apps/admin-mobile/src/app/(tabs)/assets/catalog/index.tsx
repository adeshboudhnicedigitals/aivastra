import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AssetRow } from '../../../../components/AssetRow';
import { AssetsTabBar } from '../../../../components/AssetsTabBar';
import { EmptyState } from '../../../../components/EmptyState';
import { type FilterChipOption, FilterChips } from '../../../../components/FilterChips';
import { ImagePickerButton } from '../../../../components/ImagePickerButton';
import { PickerModal } from '../../../../components/PickerModal';
import { SkeletonLoader } from '../../../../components/SkeletonLoader';
import { UploadProgress } from '../../../../components/UploadProgress';
import { useApi } from '../../../../hooks/useApi';
import { apiFetch } from '../../../../lib/api';
import { canDeleteAssets, isSuperAdmin } from '../../../../lib/roles';
import { storageUrl } from '../../../../lib/storage';
import { type UploadPhase, uploadTwoImage } from '../../../../lib/upload';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, Typography } from '../../../../styles/tokens';
import type { CatalogCategory, CatalogItem, GarmentType } from '../../../../types';

type CatalogType = 'lower' | 'shoe';
type Gender = 'none' | 'men' | 'women' | 'boys' | 'girls';
const GENDERS: readonly FilterChipOption<Gender>[] = [
  { label: 'None', value: 'none' },
  { label: 'Men', value: 'men' },
  { label: 'Women', value: 'women' },
  { label: 'Boys', value: 'boys' },
  { label: 'Girls', value: 'girls' },
];

export default function CatalogScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const type: CatalogType = params.type === 'shoe' ? 'shoe' : 'lower';
  const { bottom } = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const role = useAuthStore((state) => state.role);
  const canEdit = isSuperAdmin(role) || role === 'ADMIN';

  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const items = useApi<CatalogItem[]>(`/admin/catalog/items?type=${type}`);
  const categories = useApi<CatalogCategory[]>('/admin/catalog/categories');
  const garmentTypes = useApi<{ items: GarmentType[] }>('/admin/assets/garment-types');
  const [modalVisible, setModalVisible] = useState(false);
  const [image, setImage] = useState<{ uri: string; mime: string } | null>(null);
  const [label, setLabel] = useState('');
  const [gender, setGender] = useState<Gender>('none');
  const [sortOrder, setSortOrder] = useState('0');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categoryPicker, setCategoryPicker] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>(null);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Category create/edit state
  const [catModalVisible, setCatModalVisible] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CatalogCategory | null>(null);
  const [catLabel, setCatLabel] = useState('');
  const [catActive, setCatActive] = useState(true);
  const [catSaving, setCatSaving] = useState(false);

  // Multi-select state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [garmentTypePickerVisible, setGarmentTypePickerVisible] = useState(false);

  // The outer AssetsTabBar owns Lower/Shoes switching now — reset item-level filters
  // and any in-progress add-item state whenever the active type changes.
  useEffect(() => {
    setCategoryFilter(null);
    setCategoryId(null);
    setSelected(new Set());
  }, [type]);

  const filteredCategories = (categories.data ?? []).filter((cat) => cat.typeSlug === type);

  const filteredItems = useMemo(() => {
    const list = items.data ?? [];
    if (categoryFilter === null) return list;
    return list.filter((item) => item.categoryId === categoryFilter);
  }, [items.data, categoryFilter]);

  const selectMode = selected.size > 0;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!image || !label.trim())
      return Alert.alert('Missing fields', 'Image and label are required.');
    setSubmitting(true);
    try {
      await uploadTwoImage({
        presignEndpoint: '/admin/catalog/items/presign',
        presignBody: { contentType: image.mime, typeSlug: type },
        fileUri: image.uri,
        contentType: image.mime,
        confirmEndpoint: '/admin/catalog/items/confirm',
        confirmBody: (keys) => ({
          ...keys,
          typeSlug: type,
          genderSlug: gender === 'none' ? null : gender,
          label: label.trim(),
          sortOrder: Number(sortOrder) || 0,
          categoryId: categoryId ?? undefined,
          subcategoryIds: [],
        }),
        onProgress: (nextPhase, pct) => {
          setPhase(nextPhase);
          setProgress(pct);
        },
      });
      useToastStore.getState().show('Catalog item added', 'success');
      setModalVisible(false);
      setImage(null);
      setLabel('');
      await items.refresh();
    } catch (cause) {
      Alert.alert('Create failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSubmitting(false);
      setPhase(null);
      setProgress(0);
    }
  }

  async function bulkDelete() {
    setBulkDeleting(true);
    try {
      const ids = [...selected];
      const results = await Promise.allSettled(
        ids.map((id) => apiFetch(`/admin/catalog/items/${id}`, { method: 'DELETE' })),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        Alert.alert('Partial failure', `${failed} items could not be deleted.`);
      }
      const deleted = ids.length - failed;
      if (deleted > 0) {
        useToastStore.getState().show(`${deleted} items deleted`, 'success');
      }
      setSelected(new Set());
      await items.refresh();
    } catch (cause) {
      Alert.alert('Delete failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setBulkDeleting(false);
    }
  }

  async function bulkMapToGarmentTypes(garmentTypeIds: string[]) {
    try {
      await apiFetch('/admin/catalog/items/bulk-subcategories', {
        method: 'PATCH',
        body: JSON.stringify({ itemIds: [...selected], subcategoryIds: garmentTypeIds }),
      });
      useToastStore.getState().show(`${selected.size} items mapped`, 'success');
      setSelected(new Set());
      await items.refresh();
    } catch (cause) {
      Alert.alert('Map failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  async function bulkUnmapAll() {
    try {
      await apiFetch('/admin/catalog/items/bulk-subcategories', {
        method: 'PATCH',
        body: JSON.stringify({ itemIds: [...selected], subcategoryIds: [] }),
      });
      useToastStore.getState().show(`${selected.size} items unmapped`, 'success');
      setSelected(new Set());
      await items.refresh();
    } catch (cause) {
      Alert.alert('Unmap failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  // Category CRUD
  function openCreateCat() {
    if (!canEdit) return;
    setEditingCategory(null);
    setCatLabel('');
    setCatActive(true);
    setCatModalVisible(true);
  }

  function openEditCat(cat: CatalogCategory) {
    if (!canEdit) return;
    setEditingCategory(cat);
    setCatLabel(cat.label);
    setCatActive(cat.isActive);
    setCatModalVisible(true);
  }

  async function saveCategory() {
    if (!catLabel.trim()) return;
    setCatSaving(true);
    try {
      if (editingCategory) {
        await apiFetch(`/admin/catalog/categories/${editingCategory.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ label: catLabel.trim(), isActive: catActive }),
        });
        useToastStore.getState().show('Category updated', 'success');
      } else {
        await apiFetch('/admin/catalog/categories', {
          method: 'POST',
          body: JSON.stringify({
            typeSlug: type,
            label: catLabel.trim(),
            isActive: catActive,
          }),
        });
        useToastStore.getState().show('Category created', 'success');
      }
      setCatModalVisible(false);
      setEditingCategory(null);
      await categories.refresh();
    } catch (cause) {
      Alert.alert('Save failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setCatSaving(false);
    }
  }

  function deleteCategory(cat: CatalogCategory) {
    Alert.alert(
      'Delete category?',
      `Delete "${cat.label}"? Items in this category will become uncategorized.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiFetch(`/admin/catalog/categories/${cat.id}`, { method: 'DELETE' });
              useToastStore.getState().show(`Category "${cat.label}" deleted`, 'success');
              setCatModalVisible(false);
              setEditingCategory(null);
              await categories.refresh();
            } catch (cause) {
              Alert.alert(
                'Delete failed',
                cause instanceof Error ? cause.message : 'Please try again.',
              );
            }
          },
        },
      ],
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <AssetsTabBar active={type} />
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>
          {type === 'shoe' ? 'Shoes' : 'Lower Garments'}
        </Text>
        <View style={styles.headerActions}>
          {canEdit ? (
            <TouchableOpacity
              onPress={openCreateCat}
              style={[styles.newCatBtn, { borderColor: colors.accent }]}
            >
              <MaterialCommunityIcons color={colors.accent} name="folder-plus-outline" size={18} />
            </TouchableOpacity>
          ) : null}
          {canEdit ? (
            <TouchableOpacity
              onPress={() => setModalVisible(true)}
              style={[styles.add, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.addText, { color: colors.onAccent }]}>Add</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {filteredCategories.length > 0 ? (
        <ScrollView
          contentContainerStyle={styles.catChips}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          <TouchableOpacity
            onPress={() => setCategoryFilter(null)}
            style={[
              styles.catChip,
              {
                backgroundColor: categoryFilter === null ? colors.accent : colors.surface,
                borderColor: categoryFilter === null ? colors.accent : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.catChipText,
                { color: categoryFilter === null ? colors.onAccent : colors.textSecondary },
              ]}
            >
              All
            </Text>
          </TouchableOpacity>
          {filteredCategories.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              onLongPress={canDeleteAssets(role) ? () => openEditCat(cat) : undefined}
              onPress={() => setCategoryFilter(categoryFilter === cat.id ? null : cat.id)}
              style={[
                styles.catChip,
                {
                  backgroundColor: categoryFilter === cat.id ? colors.accent : colors.surface,
                  borderColor: categoryFilter === cat.id ? colors.accent : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.catChipText,
                  { color: categoryFilter === cat.id ? colors.onAccent : colors.textSecondary },
                ]}
              >
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}

      {items.loading && !items.data ? (
        <View style={styles.loading}>
          <SkeletonLoader count={7} variant="list" />
        </View>
      ) : items.error && !items.data ? (
        <EmptyState
          title="Catalog unavailable"
          message={items.error.message}
          actionLabel="Retry"
          onAction={() => void items.refresh()}
        />
      ) : (
        <FlatList
          contentContainerStyle={[
            styles.list,
            { paddingBottom: selectMode ? bottom + 140 : bottom + 100 },
          ]}
          data={filteredItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const category = categories.data?.find((entry) => entry.id === item.categoryId);
            return (
              <AssetRow
                thumbnailUri={storageUrl(item.thumbnailKey)}
                label={item.label}
                subtitle={item.genderSlug ?? 'All genders'}
                badge={category?.label ?? 'Uncategorized'}
                isActive={item.isActive}
                selected={selectMode ? selected.has(item.id) : undefined}
                onPress={() => {
                  if (selectMode) {
                    toggle(item.id);
                  } else {
                    router.push({
                      pathname: '/(tabs)/assets/catalog/[id]',
                      params: { id: item.id, type },
                    });
                  }
                }}
              />
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title="No catalog items"
              message={
                categoryFilter !== null
                  ? 'No items in this category.'
                  : `Add the first ${type === 'lower' ? 'lower garment' : 'shoe'}.`
              }
            />
          }
        />
      )}

      {selectMode ? (
        <View
          style={[
            styles.bulkBar,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.bulkLabel, { color: colors.text }]}>{selected.size} selected</Text>
          <TouchableOpacity onPress={() => setSelected(new Set())}>
            <Text style={[styles.bulkCancel, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setGarmentTypePickerVisible(true)}
            style={[styles.bulkAction, { backgroundColor: colors.accentContainer }]}
          >
            <Text style={[styles.bulkActionText, { color: colors.onAccentContainer }]}>Map</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                'Unmap from all?',
                `Remove all garment type assignments from ${selected.size} items?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Unmap', style: 'destructive', onPress: () => void bulkUnmapAll() },
                ],
              )
            }
            style={[styles.bulkAction, { backgroundColor: colors.warningContainer }]}
          >
            <Text style={[styles.bulkActionText, { color: colors.warning }]}>Unmap</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={bulkDeleting}
            onPress={() =>
              Alert.alert('Delete items?', `Delete ${selected.size} catalog items?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => void bulkDelete() },
              ])
            }
            style={[styles.bulkAction, { backgroundColor: colors.errorContainer }]}
          >
            <Text style={[styles.bulkActionText, { color: colors.error }]}>
              {bulkDeleting ? 'Deleting...' : 'Delete'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <ScrollView contentContainerStyle={[styles.form, { backgroundColor: colors.bg }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Add {type === 'lower' ? 'lower garment' : 'shoe'}
            </Text>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
            </TouchableOpacity>
          </View>
          <ImagePickerButton
            label="Item Image"
            uri={image?.uri ?? null}
            onPick={(uri, mime) => setImage({ uri, mime })}
          />
          <Field label="Label">
            <TextInput
              value={label}
              onChangeText={setLabel}
              style={[
                styles.input,
                { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            />
          </Field>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Gender</Text>
          <FilterChips options={GENDERS} value={gender} onChange={setGender} />
          <Field label="Category">
            <TouchableOpacity
              onPress={() => setCategoryPicker(true)}
              style={[
                styles.input,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: categoryId ? colors.text : colors.textMuted }}>
                {filteredCategories.find((category) => category.id === categoryId)?.label ??
                  'Select category'}
              </Text>
            </TouchableOpacity>
          </Field>
          <Field label="Sort Order">
            <TextInput
              keyboardType="number-pad"
              value={sortOrder}
              onChangeText={setSortOrder}
              style={[
                styles.input,
                { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            />
          </Field>
          <UploadProgress phase={phase} progress={progress} />
          <TouchableOpacity
            disabled={submitting}
            onPress={() => void submit()}
            style={[
              styles.submit,
              { backgroundColor: colors.accent },
              submitting && styles.disabled,
            ]}
          >
            <Text style={[styles.addText, { color: colors.onAccent }]}>Upload and save</Text>
          </TouchableOpacity>
        </ScrollView>
        <PickerModal
          visible={categoryPicker}
          title="Select category"
          options={filteredCategories.map((category) => ({
            id: String(category.id),
            label: category.label,
            subtitle: category.genderSlug ?? undefined,
          }))}
          onClose={() => setCategoryPicker(false)}
          onSelect={(value) => setCategoryId(Number(value))}
        />
      </Modal>

      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={catModalVisible}
        onRequestClose={() => {
          setCatModalVisible(false);
          setEditingCategory(null);
        }}
      >
        <ScrollView
          contentContainerStyle={[styles.form, { backgroundColor: colors.bg }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingCategory
                ? 'Edit Category'
                : `Add ${type === 'lower' ? 'lower' : 'shoe'} category`}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setCatModalVisible(false);
                setEditingCategory(null);
              }}
            >
              <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
            </TouchableOpacity>
          </View>
          <Field label="Label">
            <TextInput
              maxLength={100}
              onChangeText={setCatLabel}
              placeholder="Category label"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              value={catLabel}
            />
          </Field>
          <View style={styles.switchRow}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Active</Text>
            <Switch onValueChange={setCatActive} value={catActive} />
          </View>
          {editingCategory ? (
            <TouchableOpacity
              onPress={() => deleteCategory(editingCategory!)}
              style={[styles.deleteBtn, { borderColor: colors.error }]}
            >
              <Text style={[styles.deleteBtnText, { color: colors.error }]}>Delete Category</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            disabled={!catLabel.trim() || catSaving}
            onPress={() => void saveCategory()}
            style={[
              styles.submit,
              { backgroundColor: colors.accent },
              (!catLabel.trim() || catSaving) && styles.disabled,
            ]}
          >
            {catSaving ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[styles.addText, { color: colors.onAccent }]}>Save</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </Modal>

      {garmentTypePickerVisible ? (
        <MultiSelectPickerModal
          visible={garmentTypePickerVisible}
          title="Map to garment types"
          options={(garmentTypes.data?.items ?? []).map((gt) => ({
            id: gt.id,
            label: gt.label,
            subtitle: gt.genderSlug ?? undefined,
          }))}
          onClose={() => setGarmentTypePickerVisible(false)}
          onSelect={(ids) => {
            setGarmentTypePickerVisible(false);
            void bulkMapToGarmentTypes(ids);
          }}
        />
      ) : null}
    </View>
  );

  function Field({ label: fieldLabel, children }: { label: string; children: React.ReactNode }) {
    return (
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{fieldLabel}</Text>
        {children}
      </View>
    );
  }
}

function MultiSelectPickerModal({
  visible,
  title,
  options,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  options: { id: string; label: string; subtitle?: string }[];
  onClose: () => void;
  onSelect: (ids: string[]) => void;
}) {
  const { colors } = useAppTheme();
  const [sel, setSel] = useState<Set<string>>(new Set());

  function toggleOne(id: string) {
    setSel((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={[styles.pickerRoot, { backgroundColor: colors.bg }]}>
        <View style={styles.pickerHeader}>
          <Text style={[styles.pickerTitle, { color: colors.text }]}>{title}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          contentContainerStyle={styles.pickerList}
          data={options}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => toggleOne(item.id)}
              style={[
                styles.pickerRow,
                {
                  backgroundColor: colors.surface,
                  borderColor: sel.has(item.id) ? colors.accent : colors.border,
                },
              ]}
            >
              <MaterialCommunityIcons
                color={sel.has(item.id) ? colors.accent : colors.textMuted}
                name={sel.has(item.id) ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                size={24}
              />
              <View style={styles.pickerRowContent}>
                <Text style={[styles.pickerRowLabel, { color: colors.text }]}>{item.label}</Text>
                {item.subtitle ? (
                  <Text style={[styles.pickerRowSub, { color: colors.textSecondary }]}>
                    {item.subtitle}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
        />
        <TouchableOpacity
          disabled={sel.size === 0}
          onPress={() => onSelect([...sel])}
          style={[
            styles.pickerConfirm,
            { backgroundColor: colors.accent },
            sel.size === 0 && styles.disabled,
          ]}
        >
          <Text style={[styles.addText, { color: colors.onAccent }]}>
            Apply ({sel.size} selected)
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  title: { ...Typography.h1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  newCatBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: Radius.full,
  },
  add: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, borderRadius: Radius.full },
  addText: { ...Typography.bodyBold },
  catChips: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  catChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  catChipText: { ...Typography.captionBold },
  loading: { flex: 1, padding: Spacing.lg },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  form: { padding: Spacing.xl, gap: Spacing.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { ...Typography.h2 },
  close: { ...Typography.bodyBold },
  field: { gap: Spacing.sm },
  fieldLabel: { ...Typography.captionBold },
  input: {
    minHeight: 50,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    ...Typography.body,
  },
  submit: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  disabled: { opacity: 0.5 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deleteBtn: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  deleteBtnText: { ...Typography.bodyBold },
  bulkBar: {
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
  bulkCancel: { ...Typography.captionBold },
  bulkAction: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  bulkActionText: { ...Typography.captionBold },
  pickerRoot: { flex: 1, padding: Spacing.lg },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  pickerTitle: { ...Typography.h2 },
  pickerList: { gap: Spacing.sm, paddingBottom: 100 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  pickerRowContent: { flex: 1 },
  pickerRowLabel: { ...Typography.bodyBold },
  pickerRowSub: { ...Typography.caption, marginTop: 2 },
  pickerConfirm: {
    position: 'absolute',
    bottom: 32,
    left: Spacing.lg,
    right: Spacing.lg,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
});
