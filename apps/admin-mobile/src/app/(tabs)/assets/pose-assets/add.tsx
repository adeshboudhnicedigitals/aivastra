import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImagePickerButton } from '../../../../components/ImagePickerButton';
import { PickerModal } from '../../../../components/PickerModal';
import { UploadProgress } from '../../../../components/UploadProgress';
import { useApi } from '../../../../hooks/useApi';
import { apiFetch } from '../../../../lib/api';
import { makeThumbnail } from '../../../../lib/thumbnail';
import { type UploadPhase, uploadFile } from '../../../../lib/upload';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../styles/tokens';
import type { ModelBackground, ModelFace, WorkflowOption } from '../../../../types';
export default function Screen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const faces = useApi<{ items: ModelFace[] }>('/admin/assets/faces');
  const backgrounds = useApi<{ items: ModelBackground[] }>('/admin/assets/backgrounds');
  const workflows = useApi<WorkflowOption[]>('/admin/workflows');
  const [main, setMain] = useState<{ uri: string; mime: string } | null>(null);
  const [side, setSide] = useState<{ uri: string; mime: string } | null>(null);
  const [bg, setBg] = useState<{ uri: string; mime: string } | null>(null);
  const [label, setLabel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [faceId, setFaceId] = useState('');
  const [backgroundId, setBackgroundId] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [picker, setPicker] = useState<'face' | 'background' | 'workflow' | null>(null);
  const [phase, setPhase] = useState<UploadPhase>(null);
  const [progress, setProgress] = useState(0);
  async function submit() {
    if (!main || !label.trim() || !faceId || !backgroundId || !workflowId)
      return Alert.alert(
        'Missing fields',
        'Pose image, label, face, background and workflow are required.',
      );
    try {
      const body: any = { contentType: main.mime };
      if (side) body.faceSideContentType = side.mime;
      if (bg) body.bgComfyContentType = bg.mime;
      const signed = await apiFetch<any>('/admin/assets/pose-assets/presign', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setPhase('uploading-main');
      await uploadFile(signed.uploadUrl, main.uri, main.mime, setProgress);
      setPhase('uploading-thumbnail');
      const thumb = await makeThumbnail(main.uri);
      await uploadFile(signed.thumbnailUploadUrl, thumb, 'image/jpeg', setProgress);
      if (side) await uploadFile(signed.faceSideUploadUrl, side.uri, side.mime, setProgress);
      if (bg) await uploadFile(signed.bgComfyUploadUrl, bg.uri, bg.mime, setProgress);
      setPhase('confirming');
      setProgress(100);
      await apiFetch('/admin/assets/pose-assets', {
        method: 'POST',
        body: JSON.stringify({
          label: label.trim(),
          r2Key: signed.r2Key,
          thumbnailKey: signed.thumbnailKey,
          faceSideR2Key: signed.faceSideR2Key,
          bgComfyR2Key: signed.bgComfyR2Key,
          faceId,
          backgroundId,
          workflowTemplateId: workflowId,
          promptGarmentPhase: prompt || undefined,
        }),
      });
      useToastStore.getState().show('Pose asset created', 'success');
      router.back();
    } catch (c) {
      Alert.alert('Create failed', c instanceof Error ? c.message : 'Please try again.');
    } finally {
      setPhase(null);
      setProgress(0);
    }
  }
  const options =
    picker === 'face'
      ? (faces.data?.items ?? []).map((x) => ({ id: x.id, label: x.label }))
      : picker === 'background'
        ? (backgrounds.data?.items ?? []).map((x) => ({ id: x.id, label: x.label }))
        : (workflows.data ?? []).map((x) => ({ id: x.id, label: x.label, subtitle: x.slug }));
  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
        ]}
      >
        <ImagePickerButton
          label="Pose Image"
          uri={main?.uri ?? null}
          onPick={(uri, mime) => setMain({ uri, mime })}
        />
        <ImagePickerButton
          label="Face Side Image"
          uri={side?.uri ?? null}
          onPick={(uri, mime) => setSide({ uri, mime })}
        />
        <ImagePickerButton
          label="BG Comfy Image"
          uri={bg?.uri ?? null}
          onPick={(uri, mime) => setBg({ uri, mime })}
        />
        <Input label="Label" value={label} onChange={setLabel} colors={colors} />
        <Select
          label="Face"
          value={(faces.data?.items ?? []).find((x) => x.id === faceId)?.label}
          onPress={() => setPicker('face')}
          colors={colors}
        />
        <Select
          label="Background"
          value={(backgrounds.data?.items ?? []).find((x) => x.id === backgroundId)?.label}
          onPress={() => setPicker('background')}
          colors={colors}
        />
        <Select
          label="Workflow"
          value={(workflows.data ?? []).find((x) => x.id === workflowId)?.label}
          onPress={() => setPicker('workflow')}
          colors={colors}
        />
        <Input
          label="Garment prompt"
          value={prompt}
          onChange={setPrompt}
          colors={colors}
          multiline
        />
        <UploadProgress phase={phase} progress={progress} />
        <TouchableOpacity
          onPress={() => void submit()}
          style={[styles.submit, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.buttonText, { color: colors.onAccent }]}>Create pose asset</Text>
        </TouchableOpacity>
      </ScrollView>
      <PickerModal
        visible={picker !== null}
        title={`Select ${picker ?? ''}`}
        options={options}
        onClose={() => setPicker(null)}
        onSelect={(id) =>
          picker === 'face'
            ? setFaceId(id)
            : picker === 'background'
              ? setBackgroundId(id)
              : setWorkflowId(id)
        }
      />
    </>
  );
}
function Input({
  label,
  value,
  onChange,
  colors,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
  multiline?: boolean;
}) {
  return (
    <>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.multiline,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
    </>
  );
}
function Select({
  label,
  value,
  onPress,
  colors,
}: {
  label: string;
  value?: string;
  onPress: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  return (
    <>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TouchableOpacity
        onPress={onPress}
        style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface }]}
      >
        <Text style={{ color: value ? colors.text : colors.textMuted }}>
          {value ?? 'Tap to select'}
        </Text>
      </TouchableOpacity>
    </>
  );
}
const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  label: { ...Typography.captionBold },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Typography.body,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  submit: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    marginTop: Spacing.lg,
  },
  buttonText: { ...Typography.bodyBold },
});
