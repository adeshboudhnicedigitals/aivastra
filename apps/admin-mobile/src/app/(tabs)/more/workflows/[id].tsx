import * as Clipboard from 'expo-clipboard';
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
import { AccordionSection } from '../../../../components/AccordionSection';
import { confirmAction } from '../../../../components/ConfirmDialog';
import { EmptyState } from '../../../../components/EmptyState';
import { PickerModal } from '../../../../components/PickerModal';
import { useApi } from '../../../../hooks/useApi';
import { ApiError, apiFetch } from '../../../../lib/api';
import { canDeleteAssets } from '../../../../lib/roles';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../styles/tokens';
import type { WorkflowDetail, WorkflowOption } from '../../../../types';

export default function WorkflowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);
  const canWrite = canDeleteAssets(role);
  const workflow = useApi<WorkflowDetail>(`/admin/workflows/${id}`);
  const workflowOptions = useApi<WorkflowOption[]>('/admin/workflows');
  const [label, setLabel] = useState('');
  const [slug, setSlug] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (workflow.data) {
      setLabel(workflow.data.label);
      setSlug(workflow.data.slug);
    }
  }, [workflow.data]);

  async function patchWorkflow(body: object, message: string) {
    try {
      await apiFetch(`/admin/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      useToastStore.getState().show(message, 'success');
      await workflow.refresh();
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  function reassign(targetWorkflowId: string) {
    const target = workflowOptions.data?.find((item) => item.id === targetWorkflowId);
    confirmAction({
      title: 'Reassign poses?',
      message: `Move all poses to ${target?.label ?? 'the selected workflow'}?`,
      confirmLabel: 'Reassign',
      onConfirm: async () => {
        try {
          const result = await apiFetch<{ updated: number }>(`/admin/workflows/${id}/reassign`, {
            method: 'POST',
            body: JSON.stringify({ targetWorkflowId }),
          });
          useToastStore.getState().show(`${result.updated} poses reassigned`, 'success');
          await Promise.all([workflow.refresh(), workflowOptions.refresh()]);
        } catch (cause) {
          Alert.alert(
            'Reassign failed',
            cause instanceof Error ? cause.message : 'Please try again.',
          );
        }
      },
    });
  }

  function deleteWorkflow() {
    confirmAction({
      title: 'Delete workflow?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await apiFetch(`/admin/workflows/${id}`, { method: 'DELETE' });
          useToastStore.getState().show('Workflow deleted', 'success');
          router.back();
        } catch (cause) {
          const conflict = cause instanceof ApiError && cause.status === 409;
          Alert.alert(
            conflict ? 'Reassign poses first' : 'Delete failed',
            conflict
              ? 'This workflow still has assigned poses.'
              : cause instanceof Error
                ? cause.message
                : 'Please try again.',
          );
        }
      },
    });
  }

  async function copyJson() {
    if (!workflow.data?.jsonContent) return;
    try {
      await Clipboard.setStringAsync(JSON.stringify(workflow.data.jsonContent, null, 2));
      setCopied(true);
      useToastStore.getState().show('JSON copied to clipboard', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert('Copy failed', 'Could not copy to clipboard.');
    }
  }

  if (workflow.loading && !workflow.data)
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Text style={{ color: colors.textSecondary }}>Loading workflow…</Text>
      </View>
    );
  if (workflow.error && !workflow.data)
    return (
      <EmptyState
        title="Workflow unavailable"
        message={workflow.error.message}
        actionLabel="Retry"
        onAction={() => void workflow.refresh()}
      />
    );
  const item = workflow.data;
  if (!item)
    return <EmptyState title="Workflow not found" message="This workflow does not exist." />;

  const nodeRows: [string, string][] = [
    ['Face', item.faceNodeId],
    ['Pose', item.poseNodeId],
    ['Background', item.bgNodeId],
    ['Upper', item.upperNodeIds.join(', ') || 'Not set'],
    ['Lower', item.lowerNodeId ?? 'Not set'],
    ['Shoe', item.shoeNodeId ?? 'Not set'],
    ['Size', item.sizeNodeIds.join(', ') || 'Not set'],
    ['Face Prompt Node', item.facePhasePromptNode || 'Not set'],
    ['Garment Prompt Node', item.garmentPhasePromptNode || 'Not set'],
    ...(item.resultNodeId !== undefined
      ? [['Result Node', item.resultNodeId ?? 'Not set'] as [string, string]]
      : []),
    ...(item.latentSizeNodeIds?.length
      ? [['Latent Size Nodes', item.latentSizeNodeIds.join(', ')] as [string, string]]
      : []),
    ...(item.latentMaxPx !== undefined
      ? [['Latent Max Px', String(item.latentMaxPx)] as [string, string]]
      : []),
    ...(item.outputSizeNodeIds?.length
      ? [['Output Size Nodes', item.outputSizeNodeIds.join(', ')] as [string, string]]
      : []),
    ...(item.outputMaxPx !== undefined
      ? [['Output Max Px', String(item.outputMaxPx)] as [string, string]]
      : []),
    ...(item.widgetGarmentNodeId !== undefined
      ? [['Widget Garment Node', item.widgetGarmentNodeId ?? 'Not set'] as [string, string]]
      : []),
    ...(item.widgetCustomerPhotoNodeId !== undefined
      ? [
          ['Widget Customer Photo Node', item.widgetCustomerPhotoNodeId ?? 'Not set'] as [
            string,
            string,
          ],
        ]
      : []),
    ...(item.widgetOutputNodeId !== undefined
      ? [['Widget Output Node', item.widgetOutputNodeId ?? 'Not set'] as [string, string]]
      : []),
  ];
  const targets = (workflowOptions.data ?? []).filter(
    (entry) => entry.id !== item.id && entry.isActive,
  );

  const jsonString = item.jsonContent
    ? JSON.stringify(item.jsonContent, null, 2)
    : 'No JSON content available';

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
        ]}
      >
        <AccordionSection title="Metadata">
          <Text style={[styles.label, { color: colors.textSecondary }]}>Label</Text>
          <TextInput
            editable={canWrite}
            value={label}
            onChangeText={setLabel}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />
          {canWrite ? (
            <ActionButton
              label="Save label"
              onPress={() => void patchWorkflow({ label: label.trim() }, 'Workflow updated')}
              colors={colors}
            />
          ) : null}
          <Text style={[styles.label, { color: colors.textSecondary }]}>Slug</Text>
          {canWrite ? (
            <>
              <TextInput
                editable={canWrite}
                value={slug}
                onChangeText={setSlug}
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
              {slug !== item.slug ? (
                <ActionButton
                  label="Save slug"
                  onPress={() => void patchWorkflow({ slug: slug.trim() }, 'Slug updated')}
                  colors={colors}
                />
              ) : null}
            </>
          ) : (
            <Text style={[styles.value, { color: colors.text }]}>{item.slug}</Text>
          )}
          <View style={styles.toggleRow}>
            <Text style={[styles.value, { color: colors.text }]}>Active</Text>
            <Switch
              disabled={!canWrite}
              value={item.isActive}
              onValueChange={(isActive) =>
                void patchWorkflow({ isActive }, 'Workflow status updated')
              }
            />
          </View>
          <Text style={[styles.poseCount, { color: colors.accent }]}>
            {item.poseCount} pose{item.poseCount === 1 ? '' : 's'}
          </Text>
        </AccordionSection>

        <AccordionSection title="Node IDs" initiallyExpanded={false}>
          <View style={[styles.codeBlock, { backgroundColor: colors.surfaceVariant }]}>
            {nodeRows.map(([name, value]) => (
              <Text key={name} selectable style={[styles.code, { color: colors.text }]}>
                {name}: {value}
              </Text>
            ))}
          </View>
        </AccordionSection>

        <AccordionSection title="Default Prompts" initiallyExpanded={false}>
          <Prompt title="Face phase" value={item.defaultFacePhasePrompt} colors={colors} />
          <Prompt title="Garment phase" value={item.defaultGarmentPhasePrompt} colors={colors} />
        </AccordionSection>

        <AccordionSection title="Workflow JSON" initiallyExpanded={false}>
          <ScrollView
            horizontal
            style={[styles.jsonScroll, { backgroundColor: colors.surfaceVariant }]}
          >
            <ScrollView style={styles.jsonInner}>
              <Text selectable style={[styles.code, { color: colors.text }]}>
                {jsonString}
              </Text>
            </ScrollView>
          </ScrollView>
          <TouchableOpacity
            onPress={() => void copyJson()}
            style={[styles.copyButton, { backgroundColor: colors.accentContainer }]}
          >
            <Text style={[styles.copyText, { color: colors.onAccentContainer }]}>
              {copied ? 'Copied!' : 'Copy JSON'}
            </Text>
          </TouchableOpacity>
        </AccordionSection>

        {canWrite ? (
          <ActionButton
            label="Reassign poses"
            onPress={() => setPickerVisible(true)}
            colors={colors}
            disabled={!targets.length || item.poseCount === 0}
          />
        ) : null}
        {canWrite ? (
          <TouchableOpacity
            onPress={deleteWorkflow}
            style={[styles.delete, { borderColor: colors.error }]}
          >
            <Text style={[styles.buttonText, { color: colors.error }]}>Delete workflow</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
      <PickerModal
        visible={pickerVisible}
        title="Select target workflow"
        options={targets.map((entry) => ({
          id: entry.id,
          label: entry.label,
          subtitle: entry.slug,
        }))}
        onClose={() => setPickerVisible(false)}
        onSelect={reassign}
      />
    </>
  );
}

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];
function ActionButton({
  label,
  onPress,
  colors,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor: colors.accent }, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, { color: colors.onAccent }]}>{label}</Text>
    </TouchableOpacity>
  );
}
function Prompt({ title, value, colors }: { title: string; value: string; colors: ThemeColors }) {
  return (
    <View style={styles.prompt}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{title}</Text>
      <View style={[styles.promptBox, { backgroundColor: colors.surfaceVariant }]}>
        <Text selectable style={[styles.promptText, { color: colors.text }]}>
          {value || 'Not set'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.lg },
  label: { ...Typography.captionBold, marginTop: Spacing.sm },
  value: { ...Typography.bodyBold },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    ...Typography.body,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
  poseCount: { ...Typography.h3, marginTop: Spacing.md },
  codeBlock: { padding: Spacing.lg, borderRadius: Radius.md, gap: Spacing.sm },
  code: { ...Typography.code },
  prompt: { gap: Spacing.sm, marginBottom: Spacing.lg },
  promptBox: { maxHeight: 180, padding: Spacing.lg, borderRadius: Radius.md },
  promptText: { ...Typography.body },
  jsonScroll: {
    maxHeight: 320,
    borderRadius: Radius.md,
    marginTop: Spacing.sm,
  },
  jsonInner: { padding: Spacing.lg },
  copyButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    marginTop: Spacing.md,
  },
  copyText: { ...Typography.captionBold },
  button: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  buttonText: { ...Typography.bodyBold },
  delete: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  disabled: { opacity: 0.45 },
});
