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
import { SkeletonLoader } from '../../../../components/SkeletonLoader';
import { useApi } from '../../../../hooks/useApi';
import { ApiError, apiFetch } from '../../../../lib/api';
import { canDeleteAssets } from '../../../../lib/roles';
import { storageUrl } from '../../../../lib/storage';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../styles/tokens';
import type { GenderSlug, ModelFace } from '../../../../types';

const GENDERS: readonly FilterChipOption<GenderSlug>[] = [
  { label: 'Men', value: 'men' },
  { label: 'Women', value: 'women' },
  { label: 'Boys', value: 'boys' },
  { label: 'Girls', value: 'girls' },
];
export default function FaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);
  const { data, loading, error, refresh } = useApi<{ items: ModelFace[] }>('/admin/assets/faces');
  const face = data?.items.find((item) => item.id === id);
  const [label, setLabel] = useState('');
  const [gender, setGender] = useState<GenderSlug>('men');
  const [sortOrder, setSortOrder] = useState('0');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (face) {
      setLabel(face.label);
      setGender(face.gender);
      setSortOrder(String(face.sortOrder));
    }
  }, [face]);
  async function patch(body: object, message = 'Face updated') {
    setSaving(true);
    try {
      await apiFetch<{ ok: boolean }>(`/admin/assets/faces/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      useToastStore.getState().show(message, 'success');
      await refresh();
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }
  function remove() {
    confirmAction({
      title: 'Delete face?',
      message: 'The face will move to the recycle bin.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await apiFetch(`/admin/assets/faces/${id}`, { method: 'DELETE' });
          useToastStore.getState().show('Face deleted', 'success');
          router.back();
        } catch (cause) {
          Alert.alert(
            cause instanceof ApiError && cause.status === 409 ? 'Cannot delete' : 'Delete failed',
            cause instanceof ApiError && cause.status === 409
              ? 'This face is used by existing jobs.'
              : cause instanceof Error
                ? cause.message
                : 'Please try again.',
          );
        }
      },
    });
  }
  if (loading && !data)
    return (
      <ScrollView contentContainerStyle={[styles.content, { backgroundColor: colors.bg }]}>
        <SkeletonLoader count={2} variant="detail" />
      </ScrollView>
    );
  if (error && !data)
    return (
      <EmptyState
        actionLabel="Retry"
        message={error.message}
        onAction={() => void refresh()}
        title="Face unavailable"
      />
    );
  if (!face) return <EmptyState message="This face was not found." title="Face not found" />;
  const thumbUri = storageUrl(face.thumbnailKey);
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
      ]}
    >
      <Image
        contentFit="cover"
        source={thumbUri ? { uri: thumbUri } : undefined}
        style={[styles.image, { backgroundColor: colors.surfaceVariant }]}
      />
      <Section label="Label" colors={colors}>
        <TextInput
          onChangeText={setLabel}
          style={[
            styles.input,
            { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          value={label}
        />
        <Save
          disabled={saving || !label.trim()}
          colors={colors}
          onPress={() => void patch({ label: label.trim() }, 'Label saved')}
        />
      </Section>
      <Section label="Gender" colors={colors}>
        <FilterChips onChange={setGender} options={GENDERS} value={gender} />
        <Save
          disabled={saving || gender === face.gender}
          colors={colors}
          onPress={() => void patch({ gender }, 'Gender saved')}
        />
      </Section>
      <Section label="Sort order" colors={colors}>
        <TextInput
          keyboardType="number-pad"
          onChangeText={setSortOrder}
          style={[
            styles.input,
            { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          value={sortOrder}
        />
        <Save
          disabled={saving || Number(sortOrder) === face.sortOrder}
          colors={colors}
          onPress={() => void patch({ sortOrder: Number(sortOrder) || 0 }, 'Sort order saved')}
        />
      </Section>
      <View
        style={[styles.toggle, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>Active</Text>
          <Text style={[styles.help, { color: colors.textSecondary }]}>
            Available for new generation jobs
          </Text>
        </View>
        <Switch
          disabled={saving}
          onValueChange={(value) =>
            void patch({ isActive: value }, value ? 'Face activated' : 'Face deactivated')
          }
          value={face.isActive}
        />
      </View>
      {canDeleteAssets(role) ? (
        <TouchableOpacity onPress={remove} style={[styles.delete, { borderColor: colors.error }]}>
          <Text style={[styles.deleteLabel, { color: colors.error }]}>Delete Face</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}
function Section({
  label,
  colors,
  children,
}: {
  label: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{label}</Text>
      {children}
    </View>
  );
}
function Save({
  colors,
  disabled,
  onPress,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      style={[styles.save, { backgroundColor: colors.accent }, disabled && styles.disabled]}
    >
      <Text style={[styles.saveLabel, { color: colors.onAccent }]}>Save</Text>
    </TouchableOpacity>
  );
}
const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.lg },
  image: { width: 200, height: 200, alignSelf: 'center', borderRadius: Radius.xl },
  section: { padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.lg, gap: Spacing.md },
  sectionLabel: { ...Typography.bodyBold },
  help: { ...Typography.caption, marginTop: 2 },
  input: {
    minHeight: 50,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.md,
    ...Typography.body,
  },
  save: {
    alignSelf: 'flex-end',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  saveLabel: { ...Typography.bodyBold },
  toggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  delete: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  deleteLabel: { ...Typography.bodyBold },
  disabled: { opacity: 0.4 },
});
