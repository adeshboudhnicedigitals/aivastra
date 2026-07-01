import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
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
import { AssetRow } from '../../../../components/AssetRow';
import { EmptyState } from '../../../../components/EmptyState';
import { SkeletonLoader } from '../../../../components/SkeletonLoader';
import { useApi } from '../../../../hooks/useApi';
import { ApiError } from '../../../../lib/api';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { Radius, Spacing, Typography } from '../../../../styles/tokens';
import type { WorkflowOption } from '../../../../types';

const API_URL = 'http://localhost:4000';

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function WorkflowsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const token = useAuthStore((state) => state.token);
  const workflows = useApi<WorkflowOption[]>('/admin/workflows');
  const [uploadVisible, setUploadVisible] = useState(false);
  const [upLabel, setUpLabel] = useState('');
  const [upSlug, setUpSlug] = useState('');
  const [upDescription, setUpDescription] = useState('');
  const [upFileName, setUpFileName] = useState<string | null>(null);
  const [upFileUri, setUpFileUri] = useState<string | null>(null);
  const [upSlugEdited, setUpSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function openUpload() {
    setUpLabel('');
    setUpSlug('');
    setUpDescription('');
    setUpFileName(null);
    setUpFileUri(null);
    setUpSlugEdited(false);
    setUploadVisible(true);
  }

  function changeUpLabel(value: string) {
    setUpLabel(value);
    if (!upSlugEdited) setUpSlug(slugify(value));
  }

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      setUpFileName(file.name);
      setUpFileUri(file.uri);
    } catch {
      Alert.alert('Failed to pick file', 'Please try again.');
    }
  }

  async function submitUpload() {
    if (!upLabel.trim() || !upSlug || !/^[a-z0-9-]+$/.test(upSlug)) {
      return Alert.alert('Invalid input', 'Label and a valid lowercase slug are required.');
    }
    if (!upFileUri) return Alert.alert('Missing file', 'Please pick a JSON file to upload.');

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('label', upLabel.trim());
      formData.append('slug', upSlug);
      if (upDescription.trim()) formData.append('description', upDescription.trim());
      formData.append('file', {
        uri: upFileUri,
        name: upFileName ?? 'workflow.json',
        type: 'application/json',
      } as any);

      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/admin/workflows`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));

      setUpLabel('');
      setUpSlug('');
      setUpDescription('');
      setUpFileName(null);
      setUpFileUri(null);
      setUploadVisible(false);
      void workflows.refresh();
    } catch (cause) {
      Alert.alert('Upload failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (workflows.loading && !workflows.data) {
    return (
      <View style={[styles.screen, styles.loading, { backgroundColor: colors.bg }]}>
        <SkeletonLoader count={7} variant="list" />
      </View>
    );
  }
  if (workflows.error && !workflows.data) {
    return (
      <EmptyState
        title="Workflows unavailable"
        message={workflows.error.message}
        actionLabel="Retry"
        onAction={() => void workflows.refresh()}
      />
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Workflows</Text>
        <View style={styles.headerRight}>
          <Text style={[styles.count, { color: colors.textSecondary }]}>
            {workflows.data?.length ?? 0}
          </Text>
          <TouchableOpacity
            onPress={openUpload}
            style={[styles.uploadButton, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.uploadText, { color: colors.onAccent }]}>+ Upload</Text>
          </TouchableOpacity>
        </View>
      </View>
      <FlatList
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 100 }]}
        data={workflows.data ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={workflows.loading}
            onRefresh={() => void workflows.refresh()}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <AssetRow
            label={item.label}
            subtitle={item.slug}
            badge={`${item.poseCount} pose${item.poseCount === 1 ? '' : 's'}`}
            isActive={item.isActive}
            onPress={() => router.push(`/(tabs)/more/workflows/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <EmptyState title="No workflows" message="Upload a workflow JSON to get started." />
        }
      />
      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={uploadVisible}
        onRequestClose={() => setUploadVisible(false)}
      >
        <KeyboardAvoidingView
          behavior="padding"
          style={[styles.modalRoot, { backgroundColor: colors.bg }]}
        >
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Upload Workflow</Text>
              <TouchableOpacity onPress={() => setUploadVisible(false)}>
                <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
              </TouchableOpacity>
            </View>
            <Field label="Label" value={upLabel} onChangeText={changeUpLabel} />
            <Field
              label="Slug"
              value={upSlug}
              onChangeText={(v) => {
                setUpSlugEdited(true);
                setUpSlug(slugify(v));
              }}
            />
            <Field
              label="Description (optional)"
              value={upDescription}
              onChangeText={setUpDescription}
            />
            <TouchableOpacity
              onPress={pickFile}
              style={[styles.pickButton, { borderColor: colors.accent }]}
            >
              <Text style={[styles.pickText, { color: colors.accent }]}>
                {upFileName ? `File: ${upFileName}` : 'Pick JSON file'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={submitting}
              onPress={() => void submitUpload()}
              style={[
                styles.saveButton,
                { backgroundColor: colors.accent },
                submitting && styles.disabled,
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.onAccent }]}>Upload</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        onChangeText={onChangeText}
        style={[
          styles.input,
          { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 54 },
  loading: { paddingHorizontal: Spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm,
  },
  title: { ...Typography.h1 },
  count: { ...Typography.h3 },
  uploadButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  uploadText: { ...Typography.label },
  list: { gap: Spacing.sm, paddingHorizontal: Spacing.lg },
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
  pickButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  pickText: { ...Typography.bodyBold },
  saveButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  buttonText: { ...Typography.bodyBold },
  disabled: { opacity: 0.5 },
});
