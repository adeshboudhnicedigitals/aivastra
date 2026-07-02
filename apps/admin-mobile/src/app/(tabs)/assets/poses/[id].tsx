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
import { PickerModal } from '../../../../components/PickerModal';
import { useApi } from '../../../../hooks/useApi';
import { ApiError, apiFetch } from '../../../../lib/api';
import { canDeleteAssets } from '../../../../lib/roles';
import { storageUrl } from '../../../../lib/storage';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../styles/tokens';
import type { ModelPose, WorkflowOption } from '../../../../types';
export default function Screen() {
  const { id, garmentTypeId } = useLocalSearchParams<{ id: string; garmentTypeId: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((s) => s.role);
  const { data, error, refresh } = useApi<{ items: ModelPose[] }>(
    `/admin/assets/poses?garmentTypeId=${garmentTypeId}`,
  );
  const workflows = useApi<WorkflowOption[]>('/admin/workflows');
  const pose = data?.items.find((x) => x.id === id);
  const [promptFace, setPromptFace] = useState('');
  const [promptGarment, setPromptGarment] = useState('');
  const [sort, setSort] = useState('0');
  const [picker, setPicker] = useState(false);
  useEffect(() => {
    if (pose) {
      setPromptFace(pose.promptFacePhase ?? '');
      setPromptGarment(pose.promptGarmentPhase ?? '');
      setSort(String(pose.sortOrder));
    }
  }, [pose]);
  async function patch(body: object, msg = 'Pose updated') {
    try {
      await apiFetch(`/admin/assets/poses/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      useToastStore.getState().show(msg, 'success');
      await refresh();
    } catch (c) {
      Alert.alert('Update failed', c instanceof Error ? c.message : 'Please try again.');
    }
  }
  async function remove(force = false): Promise<void> {
    try {
      await apiFetch(`/admin/assets/poses/${id}?force=${force}`, { method: 'DELETE' });
      useToastStore.getState().show('Pose deleted', 'success');
      router.back();
    } catch (c) {
      if (c instanceof ApiError && c.status === 409 && !force)
        return confirmAction({
          title: 'Force delete pose?',
          message: 'This pose is used by jobs. Force delete also removes those jobs.',
          confirmLabel: 'Force Delete',
          destructive: true,
          onConfirm: () => remove(true),
        });
      Alert.alert('Delete failed', c instanceof Error ? c.message : 'Please try again.');
    }
  }
  if (error && !data)
    return (
      <EmptyState
        title="Pose unavailable"
        message={error.message}
        actionLabel="Retry"
        onAction={() => void refresh()}
      />
    );
  if (!pose) return <EmptyState title="Pose not found" message="This pose could not be loaded." />;
  const thumb = storageUrl(pose.thumbnailKey);
  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
        ]}
      >
        {thumb ? (
          <Image
            source={{ uri: thumb }}
            style={[styles.image, { backgroundColor: colors.surfaceVariant }]}
          />
        ) : null}
        <Card colors={colors}>
          <Text style={[styles.title, { color: colors.text }]}>{pose.label}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {pose.workflowLabel ?? 'No workflow'} · {pose.showsLower ? 'Lower' : ''}{' '}
            {pose.showsShoes ? 'Shoes' : ''}
          </Text>
        </Card>
        <Toggle
          label="Active"
          value={pose.isActive}
          colors={colors}
          onChange={(v) => void patch({ isActive: v })}
        />
        <Edit
          label="Face prompt"
          value={promptFace}
          setValue={setPromptFace}
          multiline
          colors={colors}
          onSave={() => void patch({ promptFacePhase: promptFace })}
        />
        <Edit
          label="Garment prompt"
          value={promptGarment}
          setValue={setPromptGarment}
          multiline
          colors={colors}
          onSave={() => void patch({ promptGarmentPhase: promptGarment })}
        />
        <Edit
          label="Sort order"
          value={sort}
          setValue={setSort}
          colors={colors}
          onSave={() => void patch({ sortOrder: Number(sort) || 0 })}
        />
        <TouchableOpacity
          onPress={() => setPicker(true)}
          style={[styles.button, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.buttonText, { color: colors.onAccent }]}>Change workflow</Text>
        </TouchableOpacity>
        {canDeleteAssets(role) ? (
          <TouchableOpacity
            onPress={() => void remove()}
            style={[styles.delete, { borderColor: colors.error }]}
          >
            <Text style={[styles.buttonText, { color: colors.error }]}>Delete Pose</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
      <PickerModal
        visible={picker}
        title="Select workflow"
        options={(workflows.data ?? []).map((x) => ({
          id: x.id,
          label: x.label,
          subtitle: x.slug,
        }))}
        onClose={() => setPicker(false)}
        onSelect={(workflowTemplateId) => void patch({ workflowTemplateId }, 'Workflow updated')}
      />
    </>
  );
}
function Card({
  children,
  colors,
}: {
  children: React.ReactNode;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {children}
    </View>
  );
}
function Toggle({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  return (
    <View
      style={[
        styles.card,
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.value, { color: colors.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}
function Edit({
  label,
  value,
  setValue,
  onSave,
  colors,
  multiline,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  onSave: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
  multiline?: boolean;
}) {
  return (
    <Card colors={colors}>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        multiline={multiline}
        value={value}
        onChangeText={setValue}
        style={[
          styles.input,
          multiline && styles.multiline,
          { color: colors.text, borderColor: colors.border },
        ]}
      />
      <TouchableOpacity onPress={onSave} style={[styles.save, { backgroundColor: colors.accent }]}>
        <Text style={[styles.buttonText, { color: colors.onAccent }]}>Save</Text>
      </TouchableOpacity>
    </Card>
  );
}
const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.lg },
  image: { width: 220, height: 220, alignSelf: 'center', borderRadius: Radius.xl },
  card: { padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.lg, gap: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...Typography.h2 },
  value: { ...Typography.bodyBold },
  meta: { ...Typography.caption },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    ...Typography.body,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  save: {
    alignSelf: 'flex-end',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  button: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  delete: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  buttonText: { ...Typography.bodyBold },
});
