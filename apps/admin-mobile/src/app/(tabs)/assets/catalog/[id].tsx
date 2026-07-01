import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { confirmAction } from '../../../../components/ConfirmDialog';
import { EmptyState } from '../../../../components/EmptyState';
import { type FilterChipOption, FilterChips } from '../../../../components/FilterChips';
import { ImagePickerButton } from '../../../../components/ImagePickerButton';
import { UploadProgress } from '../../../../components/UploadProgress';
import { useApi } from '../../../../hooks/useApi';
import { apiFetch } from '../../../../lib/api';
import { canDeleteAssets } from '../../../../lib/roles';
import { storageUrl } from '../../../../lib/storage';
import { type UploadPhase, uploadTwoImage } from '../../../../lib/upload';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../styles/tokens';
import type { CatalogCategory, CatalogItem, GarmentType } from '../../../../types';

type CatalogType = 'lower' | 'shoe';
type Gender = 'none' | 'men' | 'women' | 'boys' | 'girls';

const GENDER_OPTIONS: readonly FilterChipOption<Gender>[] = [
  { label: 'None', value: 'none' },
  { label: 'Men', value: 'men' },
  { label: 'Women', value: 'women' },
  { label: 'Boys', value: 'boys' },
  { label: 'Girls', value: 'girls' },
];

function isCatalogType(value: string | undefined): value is CatalogType {
  return value === 'lower' || value === 'shoe';
}

export default function CatalogItemDetailScreen() {
  const params = useLocalSearchParams<{ id: string; type?: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);
  const type = isCatalogType(params.type) ? params.type : 'lower';
  const items = useApi<CatalogItem[]>(`/admin/catalog/items?type=${type}`);
  const categories = useApi<CatalogCategory[]>('/admin/catalog/categories');
  const garmentTypes = useApi<{ items: GarmentType[] }>('/admin/assets/garment-types');
  const item = items.data?.find((entry) => entry.id === params.id);
  const [label, setLabel] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [gender, setGender] = useState<Gender>('none');
  const [savingAssignments, setSavingAssignments] = useState(false);

  // Image replacement state
  const [replacementUri, setReplacementUri] = useState<{ uri: string; mime: string } | null>(null);
  const [replacePhase, setReplacePhase] = useState<UploadPhase>(null);
  const [replaceProgress, setReplaceProgress] = useState(0);
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    if (!item) return;
    setLabel(item.label);
    setSortOrder(String(item.sortOrder));
    setGender((item.genderSlug as Gender | null) ?? 'none');
  }, [item]);

  async function patchItem(body: object, successMessage: string) {
    try {
      await apiFetch(`/admin/catalog/items/${params.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      useToastStore.getState().show(successMessage, 'success');
      await items.refresh();
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  async function toggleAssignment(garmentTypeId: string) {
    if (!item || savingAssignments) return;
    const selected = new Set(item.subcategoryIds);
    if (selected.has(garmentTypeId)) selected.delete(garmentTypeId);
    else selected.add(garmentTypeId);
    setSavingAssignments(true);
    try {
      await apiFetch(`/admin/catalog/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ subcategoryIds: [...selected] }),
      });
      useToastStore.getState().show('Assignments updated', 'success');
      await items.refresh();
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSavingAssignments(false);
    }
  }

  function deleteItem() {
    if (!item) return;
    confirmAction({
      title: 'Delete catalog item?',
      message: 'This removes the item from the admin catalog.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await apiFetch(`/admin/catalog/items/${item.id}`, { method: 'DELETE' });
          useToastStore.getState().show('Catalog item deleted', 'success');
          router.back();
        } catch (cause) {
          Alert.alert(
            'Delete failed',
            cause instanceof Error ? cause.message : 'Please try again.',
          );
        }
      },
    });
  }

  async function replaceImage() {
    if (!item || !replacementUri) return;
    setReplacing(true);
    try {
      await uploadTwoImage({
        presignEndpoint: `/admin/catalog/items/${item.id}/image/presign`,
        presignBody: { contentType: replacementUri.mime, typeSlug: item.type },
        fileUri: replacementUri.uri,
        contentType: replacementUri.mime,
        confirmEndpoint: `/admin/catalog/items/${item.id}/image/confirm`,
        confirmBody: (keys) => ({
          ...keys,
          typeSlug: item.type,
        }),
        onProgress: (nextPhase, pct) => {
          setReplacePhase(nextPhase);
          setReplaceProgress(pct);
        },
      });
      useToastStore.getState().show('Image replaced', 'success');
      setReplacementUri(null);
      await items.refresh();
    } catch (cause) {
      Alert.alert('Replace failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setReplacing(false);
      setReplacePhase(null);
      setReplaceProgress(0);
    }
  }

  if (items.loading && !items.data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>Loading catalog item…</Text>
      </View>
    );
  }
  if (items.error && !items.data) {
    return (
      <EmptyState
        title="Catalog item unavailable"
        message={items.error.message}
        actionLabel="Retry"
        onAction={() => void items.refresh()}
      />
    );
  }
  if (!item)
    return <EmptyState title="Catalog item not found" message="This item no longer exists." />;

  const thumbnailUri = storageUrl(item.thumbnailKey);
  const category = categories.data?.find((entry) => entry.id === item.categoryId);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
      ]}
    >
      {thumbnailUri ? (
        <Image
          contentFit="cover"
          source={{ uri: replacementUri ? replacementUri.uri : thumbnailUri }}
          style={[styles.image, { backgroundColor: colors.surfaceVariant }]}
        />
      ) : null}
      <ImagePickerButton
        label="Replace Image"
        uri={replacementUri?.uri ?? null}
        onPick={(uri, mime) => setReplacementUri({ uri, mime })}
      />
      <UploadProgress phase={replacePhase} progress={replaceProgress} />
      {replacementUri ? (
        <TouchableOpacity
          disabled={replacing}
          onPress={() => void replaceImage()}
          style={[
            styles.replaceButton,
            { backgroundColor: colors.accent },
            replacing && styles.disabled,
          ]}
        >
          <Text style={[styles.bodyBold, { color: colors.onAccent }]}>
            {replacing ? 'Uploading...' : 'Upload new image'}
          </Text>
        </TouchableOpacity>
      ) : null}
      <Section colors={colors}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Label</Text>
        <TextInput
          maxLength={100}
          onChangeText={setLabel}
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          value={label}
        />
        <Button
          colors={colors}
          label="Save label"
          onPress={() => void patchItem({ label: label.trim() }, 'Label saved')}
        />
      </Section>
      <Section colors={colors}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Type</Text>
        <View style={[styles.readOnlyChip, { backgroundColor: colors.infoContainer }]}>
          <Text style={[styles.chipText, { color: colors.info }]}>
            {item.type === 'lower' ? 'Lower garment' : 'Shoe'}
          </Text>
        </View>
      </Section>
      <Section colors={colors}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Gender</Text>
        <FilterChips options={GENDER_OPTIONS} value={gender} onChange={setGender} />
        <Button
          colors={colors}
          label="Save gender"
          onPress={() =>
            void patchItem({ genderSlug: gender === 'none' ? null : gender }, 'Gender saved')
          }
        />
      </Section>
      <View
        style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[styles.bodyBold, { color: colors.text }]}>Active</Text>
        <Switch
          onValueChange={(isActive) => void patchItem({ isActive }, 'Status updated')}
          value={item.isActive}
        />
      </View>
      <Section colors={colors}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Sort order</Text>
        <TextInput
          keyboardType="number-pad"
          onChangeText={setSortOrder}
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          value={sortOrder}
        />
        <Button
          colors={colors}
          label="Save order"
          onPress={() => void patchItem({ sortOrder: Number(sortOrder) || 0 }, 'Sort order saved')}
        />
      </Section>
      <Section colors={colors}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Category</Text>
        <Text style={[styles.bodyBold, { color: colors.text }]}>
          {category?.label ?? 'Uncategorized'}
        </Text>
        <Text style={[styles.help, { color: colors.textMuted }]}>
          Category editing is web-admin only.
        </Text>
      </Section>
      <Section colors={colors}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Garment type assignments</Text>
        <View style={styles.assignmentGrid}>
          {(garmentTypes.data?.items ?? []).map((garmentType) => {
            const selected = item.subcategoryIds.includes(garmentType.id);
            return (
              <TouchableOpacity
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected, disabled: savingAssignments }}
                disabled={savingAssignments}
                key={garmentType.id}
                onPress={() => void toggleAssignment(garmentType.id)}
                style={[
                  styles.assignmentChip,
                  {
                    backgroundColor: selected ? colors.accentContainer : colors.surfaceVariant,
                    borderColor: selected ? colors.accent : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: selected ? colors.onAccentContainer : colors.textSecondary },
                  ]}
                >
                  {garmentType.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Section>
      {canDeleteAssets(role) ? (
        <TouchableOpacity
          onPress={deleteItem}
          style={[styles.deleteButton, { borderColor: colors.error }]}
        >
          <Text style={[styles.bodyBold, { color: colors.error }]}>Delete catalog item</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

function Section({ children, colors }: { children: React.ReactNode; colors: ThemeColors }) {
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

function Button({
  colors,
  label,
  onPress,
}: {
  colors: ThemeColors;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.button, { backgroundColor: colors.accent }]}>
      <Text style={[styles.bodyBold, { color: colors.onAccent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, gap: Spacing.lg, padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  image: { width: 220, height: 220, alignSelf: 'center', borderRadius: Radius.xl },
  section: { gap: Spacing.md, padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.lg },
  sectionTitle: { ...Typography.h3 },
  fieldLabel: { ...Typography.captionBold },
  body: { ...Typography.body },
  bodyBold: { ...Typography.bodyBold },
  help: { ...Typography.caption },
  input: {
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.md,
    ...Typography.body,
  },
  button: {
    alignSelf: 'flex-end',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  readOnlyChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  chipText: { ...Typography.captionBold },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  assignmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  assignmentChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  deleteButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  replaceButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  disabled: { opacity: 0.5 },
});
