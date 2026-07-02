import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
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
import { SkeletonLoader } from '../../../../components/SkeletonLoader';
import { useApi } from '../../../../hooks/useApi';
import { apiFetch } from '../../../../lib/api';
import { storageUrl } from '../../../../lib/storage';
import { uploadSingleThumb } from '../../../../lib/upload';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, Typography } from '../../../../styles/tokens';
import type { GarmentType, GenderSlug } from '../../../../types';

const GENDERS: readonly FilterChipOption<GenderSlug>[] = [
  { label: 'Men', value: 'men' },
  { label: 'Women', value: 'women' },
  { label: 'Boys', value: 'boys' },
  { label: 'Girls', value: 'girls' },
];
const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
export default function Screen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const { data, loading, error, refresh } = useApi<{ items: GarmentType[] }>(
    '/admin/assets/garment-types',
  );
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [slug, setSlug] = useState('');
  const [gender, setGender] = useState<GenderSlug>('men');
  const [sort, setSort] = useState('0');
  const [lower, setLower] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    if (!label.trim() || !slug.match(/^[a-z0-9-]+$/))
      return Alert.alert('Invalid form', 'Label and a valid slug are required.');
    setSubmitting(true);
    try {
      let thumbnailKey: string | undefined;
      if (uri)
        ({ thumbnailKey } = await uploadSingleThumb({
          presignEndpoint: '/admin/assets/garment-types/presign',
          presignBody: { contentType: 'image/jpeg' },
          fileUri: uri,
        }));
      await apiFetch('/admin/assets/garment-types', {
        method: 'POST',
        body: JSON.stringify({
          genderSlug: gender,
          slug,
          label: label.trim(),
          sortOrder: Number(sort) || 0,
          thumbnailKey,
          requiresLowerUpload: lower,
        }),
      });
      useToastStore.getState().show('Garment type added', 'success');
      setOpen(false);
      await refresh();
    } catch (cause) {
      Alert.alert('Create failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }
  if (loading && !data)
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <AssetsTabBar active="garment-types" />
        <View style={styles.loading}>
          <SkeletonLoader count={6} variant="list" />
        </View>
      </View>
    );
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <AssetsTabBar active="garment-types" />
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Garment Types</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            {data?.items.length ?? 0} types
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={[styles.add, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.addText, { color: colors.onAccent }]}>Add</Text>
        </TouchableOpacity>
      </View>
      {error ? (
        <Text style={[styles.error, { color: colors.warning }]}>Refresh failed.</Text>
      ) : null}
      <FlatList
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 100 }]}
        data={data?.items ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <AssetRow
            badge={`${item.poseCount ?? 0} poses`}
            isActive={item.isActive}
            label={item.label}
            onPress={() => router.push(`/(tabs)/assets/garment-types/${item.id}`)}
            subtitle={`${item.genderSlug} · ${item.slug}`}
            thumbnailUri={storageUrl(item.thumbnailKey)}
          />
        )}
        ListEmptyComponent={
          <EmptyState title="No garment types" message="Add the first garment type." />
        }
      />
      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={open}
        onRequestClose={() => setOpen(false)}
      >
        <ScrollView contentContainerStyle={[styles.form, { backgroundColor: colors.bg }]}>
          <Text style={[styles.title, { color: colors.text }]}>Add garment type</Text>
          <ImagePickerButton label="Thumbnail" uri={uri} onPick={(next) => setUri(next)} />
          <Input
            label="Label"
            value={label}
            onChange={(value) => {
              setLabel(value);
              if (!slug) setSlug(slugify(value));
            }}
            colors={colors}
          />
          <Input label="Slug" value={slug} onChange={setSlug} colors={colors} />
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Gender</Text>
          <FilterChips options={GENDERS} value={gender} onChange={setGender} />
          <Input label="Sort order" value={sort} onChange={setSort} colors={colors} numeric />
          <View style={styles.switchRow}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Requires lower upload</Text>
            <Switch value={lower} onValueChange={setLower} />
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={submitting}
            onPress={() => void submit()}
            style={[
              styles.submit,
              { backgroundColor: colors.accent },
              submitting && styles.disabled,
            ]}
          >
            <Text style={[styles.addText, { color: colors.onAccent }]}>Create</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </View>
  );
}
function Input({
  label,
  value,
  onChange,
  colors,
  numeric,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
  numeric?: boolean;
}) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        keyboardType={numeric ? 'number-pad' : 'default'}
        value={value}
        onChangeText={onChange}
        style={[
          styles.input,
          { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, padding: Spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  title: { ...Typography.h1 },
  sub: { ...Typography.caption },
  add: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, borderRadius: Radius.full },
  addText: { ...Typography.bodyBold },
  error: { ...Typography.captionBold, textAlign: 'center' },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  form: { padding: Spacing.xl, gap: Spacing.lg },
  fieldLabel: { ...Typography.captionBold, marginBottom: Spacing.sm },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    ...Typography.body,
  },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  submit: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  disabled: { opacity: 0.5 },
});
