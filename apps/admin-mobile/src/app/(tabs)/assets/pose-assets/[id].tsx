import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccordionSection } from '../../../../components/AccordionSection';
import { confirmAction } from '../../../../components/ConfirmDialog';
import { EmptyState } from '../../../../components/EmptyState';
import { PickerModal } from '../../../../components/PickerModal';
import { useApi } from '../../../../hooks/useApi';
import { ApiError, apiFetch } from '../../../../lib/api';
import { storageUrl } from '../../../../lib/storage';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../styles/tokens';
import type { GarmentType, ModelPoseAsset } from '../../../../types';

interface Mapping {
  id: string;
  garmentTypeId: string;
  garmentTypeLabel: string | null;
  faceLabel: string | null;
  backgroundLabel: string | null;
  workflowLabel: string | null;
  isActive: boolean;
}

export default function PoseAssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const assets = useApi<{ items: ModelPoseAsset[] }>('/admin/assets/pose-assets');
  const mappings = useApi<{ items: Mapping[] }>(`/admin/assets/pose-assets/${id}/mappings`);
  const garmentTypes = useApi<{ items: GarmentType[] }>('/admin/assets/garment-types');
  const asset = assets.data?.items.find((item) => item.id === id);
  const [label, setLabel] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);

  useEffect(() => {
    if (!asset) return;
    setLabel(asset.label);
    setDisplayName(asset.displayName ?? '');
    setPrompt(asset.promptGarmentPhase ?? '');
  }, [asset]);

  async function saveMetadata() {
    try {
      await apiFetch(`/admin/assets/pose-assets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          label: label.trim(),
          displayName: displayName.trim() || null,
          promptGarmentPhase: prompt.trim() || null,
        }),
      });
      useToastStore.getState().show('Pose asset updated', 'success');
      await assets.refresh();
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  async function mapToGarmentType(garmentTypeId: string) {
    try {
      await apiFetch(`/admin/assets/pose-assets/${id}/map`, {
        method: 'POST',
        body: JSON.stringify({ garmentTypeId }),
      });
      useToastStore.getState().show('Pose asset mapped', 'success');
      await mappings.refresh();
    } catch (cause) {
      Alert.alert(
        'Mapping failed',
        cause instanceof Error ? cause.message : 'Set face, background and workflow first.',
      );
    }
  }

  async function remove(force = false): Promise<void> {
    try {
      await apiFetch(`/admin/assets/pose-assets/${id}?force=${force}`, { method: 'DELETE' });
      useToastStore.getState().show('Pose asset deleted', 'success');
      router.back();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && !force) {
        confirmAction({
          title: 'Force delete?',
          message: 'This asset has garment type mappings.',
          confirmLabel: 'Force Delete',
          destructive: true,
          onConfirm: () => remove(true),
        });
        return;
      }
      Alert.alert('Delete failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  if (assets.error && !assets.data)
    return (
      <EmptyState
        title="Pose asset unavailable"
        message={assets.error.message}
        actionLabel="Retry"
        onAction={() => void assets.refresh()}
      />
    );
  if (!asset)
    return <EmptyState title="Pose asset not found" message="This asset could not be loaded." />;
  const thumbUri = storageUrl(asset.thumbnailKey);

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
        ]}
      >
        {thumbUri ? (
          <Image
            source={{ uri: thumbUri }}
            style={[styles.image, { backgroundColor: colors.surfaceVariant }]}
          />
        ) : null}
        <View style={styles.flags}>
          <Chip text={asset.faceSideR2Key ? 'Face side set' : 'Face side not set'} />
          <Chip text={asset.bgComfyR2Key ? 'BG comfy set' : 'BG comfy not set'} />
        </View>
        <AccordionSection title="Metadata">
          <Field label="Label" value={label} onChange={setLabel} />
          <Field label="Display name" value={displayName} onChange={setDisplayName} />
          <Field label="Garment prompt" value={prompt} onChange={setPrompt} multiline />
          <TouchableOpacity
            onPress={() => void saveMetadata()}
            style={[styles.button, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.buttonText, { color: colors.onAccent }]}>Save metadata</Text>
          </TouchableOpacity>
        </AccordionSection>
        <AccordionSection title={`Mappings ${mappings.data?.items.length ?? 0}`}>
          {(mappings.data?.items ?? []).map((mapping) => (
            <TouchableOpacity
              key={mapping.id}
              onPress={() =>
                router.push(
                  `/(tabs)/assets/poses/${mapping.id}?garmentTypeId=${mapping.garmentTypeId}`,
                )
              }
              style={[styles.mapping, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.mappingTitle, { color: colors.text }]}>
                {mapping.garmentTypeLabel ?? 'Garment type'}
              </Text>
              <Text style={[styles.mappingMeta, { color: colors.textSecondary }]}>
                {mapping.faceLabel ?? 'Face'} · {mapping.backgroundLabel ?? 'Background'} ·{' '}
                {mapping.workflowLabel ?? 'Workflow'}
              </Text>
            </TouchableOpacity>
          ))}
        </AccordionSection>
        <TouchableOpacity
          onPress={() => setPickerVisible(true)}
          style={[styles.button, { backgroundColor: colors.accentContainer }]}
        >
          <Text style={[styles.buttonText, { color: colors.onAccentContainer }]}>
            Map to garment type
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => void remove()}
          style={[styles.delete, { borderColor: colors.error }]}
        >
          <Text style={[styles.buttonText, { color: colors.error }]}>Delete pose asset</Text>
        </TouchableOpacity>
      </ScrollView>
      <PickerModal
        visible={pickerVisible}
        title="Select garment type"
        options={(garmentTypes.data?.items ?? []).map((item) => ({
          id: item.id,
          label: item.label,
          subtitle: item.genderSlug,
        }))}
        onClose={() => setPickerVisible(false)}
        onSelect={(garmentTypeId) => void mapToGarmentType(garmentTypeId)}
      />
    </>
  );

  function Field({
    label: fieldLabel,
    value,
    onChange,
    multiline = false,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    multiline?: boolean;
  }) {
    return (
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{fieldLabel}</Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          multiline={multiline}
          style={[
            styles.input,
            multiline && styles.multiline,
            { color: colors.text, borderColor: colors.border },
          ]}
        />
      </View>
    );
  }

  function Chip({ text }: { text: string }) {
    return (
      <View style={[styles.chip, { backgroundColor: colors.surfaceVariant }]}>
        <Text style={[styles.chipText, { color: colors.textSecondary }]}>{text}</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.lg },
  image: { width: 220, height: 220, alignSelf: 'center', borderRadius: Radius.xl },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full },
  chipText: { ...Typography.captionBold },
  field: { gap: Spacing.sm, marginBottom: Spacing.md },
  label: { ...Typography.captionBold },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    ...Typography.body,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  button: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  buttonText: { ...Typography.bodyBold },
  mapping: { paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  mappingTitle: { ...Typography.bodyBold },
  mappingMeta: { ...Typography.caption },
  delete: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
});
