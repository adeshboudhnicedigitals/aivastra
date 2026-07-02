import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { confirmAction } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { ImagePickerButton } from '../../../components/ImagePickerButton';
import { SkeletonLoader } from '../../../components/SkeletonLoader';
import { UploadProgress } from '../../../components/UploadProgress';
import { apiFetch } from '../../../lib/api';
import { canManageTryonSaree } from '../../../lib/roles';
import { type UploadPhase, uploadTwoImage } from '../../../lib/upload';
import { useAuthStore } from '../../../store/auth';
import { useAppTheme } from '../../../store/theme';
import { useToastStore } from '../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../styles/tokens';
import type { SareeSettings, SareeWorker, SareeWorkflow } from '../../../types';

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function SareeScreen() {
  const role = useAuthStore((state) => state.role);
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const [workflow, setWorkflow] = useState<SareeWorkflow | null>(null);
  const [settings, setSettings] = useState<SareeSettings | null>(null);
  const [workers, setWorkers] = useState<SareeWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [wfModalVisible, setWfModalVisible] = useState(false);

  const [modelPhase, setModelPhase] = useState<UploadPhase>(null);
  const [modelProgress, setModelProgress] = useState(0);
  const [samplePhase, setSamplePhase] = useState<UploadPhase>(null);
  const [sampleProgress, setSampleProgress] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [wf, st, ws] = await Promise.allSettled([
      apiFetch<SareeWorkflow>('/admin/saree-workflows/active'),
      apiFetch<SareeSettings>('/admin/saree-settings'),
      apiFetch<SareeWorker[]>('/admin/saree-workers'),
    ]);
    setWorkflow(wf.status === 'fulfilled' ? wf.value : null);
    setSettings(st.status === 'fulfilled' ? st.value : null);
    setWorkers(ws.status === 'fulfilled' ? ws.value : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canManageTryonSaree(role))
    return <EmptyState title="Access denied" message="Super admin or moderator only." />;

  function confirmDeactivate() {
    if (!workflow) return;
    confirmAction({
      title: 'Deactivate workflow?',
      message: 'Saree try-on will stop working until a new workflow is uploaded.',
      confirmLabel: 'Deactivate',
      destructive: true,
      onConfirm: async () => {
        await apiFetch(`/admin/saree-workflows/${workflow.id}`, { method: 'DELETE' });
        useToastStore.getState().show('Saree workflow deactivated', 'success');
        await load();
      },
    });
  }

  async function uploadModel(uri: string, mime: string) {
    try {
      await uploadTwoImage({
        presignEndpoint: '/admin/saree-settings/presign',
        presignBody: { contentType: mime },
        fileUri: uri,
        contentType: mime,
        confirmEndpoint: '/admin/saree-settings',
        confirmMethod: 'PATCH',
        confirmBody: (keys) => ({
          modelImageKey: keys.r2Key,
          modelImageThumbKey: keys.thumbnailKey,
        }),
        onProgress: (phase, pct) => {
          setModelPhase(phase);
          setModelProgress(pct);
        },
      });
      setSettings(await apiFetch<SareeSettings>('/admin/saree-settings'));
      useToastStore.getState().show('Model image updated', 'success');
    } catch (cause) {
      Alert.alert('Upload failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setModelPhase(null);
    }
  }

  function confirmRemoveModel() {
    confirmAction({
      title: 'Remove model image?',
      message: 'Saree try-on will be disabled for users until a new one is uploaded.',
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: async () => {
        await apiFetch('/admin/saree-settings', {
          method: 'PATCH',
          body: JSON.stringify({ modelImageKey: null, modelImageThumbKey: null }),
        });
        setSettings(await apiFetch<SareeSettings>('/admin/saree-settings'));
        useToastStore.getState().show('Model image removed', 'success');
      },
    });
  }

  async function uploadSample(uri: string, mime: string) {
    try {
      await uploadTwoImage({
        presignEndpoint: '/admin/saree-settings/presign',
        presignBody: { contentType: mime, purpose: 'sample' },
        fileUri: uri,
        contentType: mime,
        confirmEndpoint: '/admin/saree-settings',
        confirmMethod: 'PATCH',
        confirmBody: (keys) => ({
          sampleSareeImageKey: keys.r2Key,
          sampleSareeImageThumbKey: keys.thumbnailKey,
        }),
        onProgress: (phase, pct) => {
          setSamplePhase(phase);
          setSampleProgress(pct);
        },
      });
      setSettings(await apiFetch<SareeSettings>('/admin/saree-settings'));
      useToastStore.getState().show('Sample saree image updated', 'success');
    } catch (cause) {
      Alert.alert('Upload failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSamplePhase(null);
    }
  }

  function confirmRemoveSample() {
    confirmAction({
      title: 'Remove sample image?',
      message: 'Users will no longer see an example saree photo.',
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: async () => {
        await apiFetch('/admin/saree-settings', {
          method: 'PATCH',
          body: JSON.stringify({ sampleSareeImageKey: null, sampleSareeImageThumbKey: null }),
        });
        setSettings(await apiFetch<SareeSettings>('/admin/saree-settings'));
        useToastStore.getState().show('Sample saree image removed', 'success');
      },
    });
  }

  const sareeCapableCount = workers.filter((w) => w.allowedJobTypes.includes('saree')).length;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.screen,
        { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={() => void load()}
          tintColor={colors.accent}
        />
      }
    >
      <Text style={[styles.title, { color: colors.text }]}>Saree Try-On</Text>
      <Text style={[styles.help, { color: colors.textMuted }]}>
        Temporary feature — upload the ComfyUI workflow and the static model image.
      </Text>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>1. ComfyUI Workflow</Text>
        </View>
        {loading ? (
          <SkeletonLoader count={1} variant="card" />
        ) : workflow ? (
          <View style={styles.gap}>
            <View style={styles.wfLine}>
              <Text style={[styles.bold, { color: colors.text }]}>{workflow.label}</Text>
              <Text style={[styles.mono, { color: colors.textMuted }]}>{workflow.slug}</Text>
              <View style={[styles.smallBadge, { backgroundColor: colors.successContainer }]}>
                <Text style={[styles.badgeText, { color: colors.success }]}>Active</Text>
              </View>
            </View>
            <Text style={[styles.caption, { color: colors.textMuted }]}>
              Model: {workflow.detected.modelImageNode ?? '—'} · Saree:{' '}
              {workflow.detected.sareeImageNode ?? '—'} · Output:{' '}
              {workflow.detected.outputNode ?? '—'}
            </Text>
          </View>
        ) : (
          <Text style={[styles.caption, { color: colors.textMuted }]}>No active workflow.</Text>
        )}
        <View style={styles.rowGap}>
          {workflow ? (
            <TouchableOpacity
              onPress={confirmDeactivate}
              style={[styles.ghostButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.ghostButtonText, { color: colors.error }]}>Deactivate</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => setWfModalVisible(true)}
            style={[styles.primaryButton, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.primaryButtonText, { color: colors.onAccent }]}>
              {workflow ? 'Replace workflow' : 'Upload workflow'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>2. Model Image</Text>
        <ImagePickerButton
          disabled={modelPhase !== null}
          onPick={(uri, mime) => void uploadModel(uri, mime)}
          size={100}
          uri={settings?.modelImageThumbUrl ?? settings?.modelImageUrl ?? null}
        />
        <Text style={[styles.caption, { color: colors.textMuted }]}>
          {settings?.isConfigured
            ? 'Image uploaded — used as the model for every saree job.'
            : 'No image yet — saree try-on is disabled for users until you upload one.'}
        </Text>
        <UploadProgress phase={modelPhase} progress={modelProgress} />
        {settings?.isConfigured ? (
          <TouchableOpacity onPress={confirmRemoveModel}>
            <Text style={[styles.linkText, { color: colors.error }]}>Remove</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>3. Sample Saree Image</Text>
        <ImagePickerButton
          disabled={samplePhase !== null}
          onPick={(uri, mime) => void uploadSample(uri, mime)}
          size={100}
          uri={settings?.sampleSareeImageThumbUrl ?? settings?.sampleSareeImageUrl ?? null}
        />
        <Text style={[styles.caption, { color: colors.textMuted }]}>
          {settings?.sampleSareeImageKey
            ? 'Shown to users as a guide before they upload their own saree photo.'
            : 'Optional. Upload a sample so users know what a good input looks like.'}
        </Text>
        <UploadProgress phase={samplePhase} progress={sampleProgress} />
        {settings?.sampleSareeImageKey ? (
          <TouchableOpacity onPress={confirmRemoveSample}>
            <Text style={[styles.linkText, { color: colors.error }]}>Remove</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>4. Worker Selection</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/more/workers')}>
            <Text style={[styles.linkText, { color: colors.accent }]}>Edit workers →</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.caption, { color: colors.textMuted }]}>
          Workers with "saree" in their allowed job types can process saree jobs.{' '}
          {sareeCapableCount} of {workers.length} workers are saree-capable.
        </Text>
        {workers.map((w) => {
          const capable = w.allowedJobTypes.includes('saree');
          return (
            <View key={w.id} style={styles.workerRow}>
              <Text numberOfLines={1} style={[styles.workerLabel, { color: colors.text }]}>
                {w.label || w.id}
              </Text>
              <View
                style={[
                  styles.smallBadge,
                  { backgroundColor: capable ? colors.successContainer : colors.surfaceVariant },
                ]}
              >
                <Text
                  style={[styles.badgeText, { color: capable ? colors.success : colors.textMuted }]}
                >
                  {capable ? 'Saree-capable' : 'No'}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <WorkflowUploadModal
        visible={wfModalVisible}
        onClose={() => setWfModalVisible(false)}
        onUploaded={async (created) => {
          setWorkflow(created);
          setWfModalVisible(false);
        }}
      />
    </ScrollView>
  );
}

function WorkflowUploadModal({
  visible,
  onClose,
  onUploaded,
}: {
  visible: boolean;
  onClose: () => void;
  onUploaded: (workflow: SareeWorkflow) => void;
}) {
  const { colors } = useAppTheme();
  const [label, setLabel] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLabel('');
    setSlug('');
    setSlugEdited(false);
    setFileName(null);
    setFileUri(null);
  }, [visible]);

  function changeLabel(value: string) {
    setLabel(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    setFileName(result.assets[0].name);
    setFileUri(result.assets[0].uri);
  }

  async function submit() {
    if (!label.trim() || !slug.trim() || !fileUri) return;
    setSaving(true);
    try {
      const text = await fetch(fileUri).then((res) => res.text());
      const jsonContent = JSON.parse(text) as Record<string, unknown>;
      const created = await apiFetch<SareeWorkflow>('/admin/saree-workflows', {
        method: 'POST',
        body: JSON.stringify({ label: label.trim(), slug: slug.trim(), jsonContent }),
      });
      useToastStore.getState().show('Saree workflow uploaded', 'success');
      onUploaded(created);
    } catch (cause) {
      Alert.alert('Upload failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={[styles.modalRoot, { backgroundColor: colors.bg }]}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Upload saree workflow</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Label</Text>
            <TextInput
              onChangeText={changeLabel}
              placeholder="e.g. Saree default"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              value={label}
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Slug</Text>
            <TextInput
              onChangeText={(v) => {
                setSlugEdited(true);
                setSlug(slugify(v));
              }}
              placeholder="kebab-case"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              value={slug}
            />
          </View>
          <TouchableOpacity
            onPress={() => void pickFile()}
            style={[styles.ghostButton, styles.pickButton, { borderColor: colors.accent }]}
          >
            <Text style={[styles.ghostButtonText, { color: colors.accent }]}>
              {fileName ? `File: ${fileName}` : 'Choose .json file'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={saving || !label.trim() || !slug.trim() || !fileUri}
            onPress={() => void submit()}
            style={[
              styles.saveButton,
              { backgroundColor: colors.accent },
              (saving || !label.trim() || !slug.trim() || !fileUri) && styles.disabled,
            ]}
          >
            <Text style={[styles.saveButtonText, { color: colors.onAccent }]}>
              {saving ? 'Uploading…' : 'Upload'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, gap: Spacing.lg, padding: Spacing.lg },
  title: { ...Typography.h1 },
  help: { ...Typography.caption, marginTop: -Spacing.sm },
  card: { gap: Spacing.md, padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.xl },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { ...Typography.bodyBold },
  gap: { gap: Spacing.xs },
  wfLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.sm },
  bold: { ...Typography.bodyBold },
  mono: { fontFamily: 'monospace', ...Typography.caption },
  caption: { ...Typography.caption },
  smallBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { ...Typography.label },
  rowGap: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' },
  ghostButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  ghostButtonText: { ...Typography.captionBold },
  primaryButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  primaryButtonText: { ...Typography.captionBold },
  linkText: { ...Typography.captionBold },
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  workerLabel: { ...Typography.body, flex: 1 },
  modalRoot: { flex: 1 },
  form: { gap: Spacing.lg, padding: Spacing.xl, paddingBottom: Spacing.xxxl },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { ...Typography.h2 },
  close: { ...Typography.bodyBold },
  field: { gap: Spacing.sm },
  fieldLabel: { ...Typography.captionBold },
  input: {
    minHeight: 50,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
    ...Typography.body,
  },
  pickButton: { alignItems: 'center' },
  saveButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  saveButtonText: { ...Typography.bodyBold },
  disabled: { opacity: 0.5 },
});
