import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccordionSection } from '../../../../components/AccordionSection';
import { confirmAction } from '../../../../components/ConfirmDialog';
import { EmptyState } from '../../../../components/EmptyState';
import { ImagePickerButton } from '../../../../components/ImagePickerButton';
import { PickerModal } from '../../../../components/PickerModal';
import { useApi } from '../../../../hooks/useApi';
import { ApiError, apiFetch } from '../../../../lib/api';
import { canDeleteAssets } from '../../../../lib/roles';
import { storageUrl } from '../../../../lib/storage';
import { uploadSingleThumb } from '../../../../lib/upload';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../styles/tokens';
import type {
  CatalogItem,
  GarmentType,
  PoseGarmentConfig,
  WorkflowOption,
} from '../../../../types';

export default function GarmentTypeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);
  const { data, loading, error, refresh } = useApi<{ items: GarmentType[] }>(
    '/admin/assets/garment-types',
  );
  const lowerItems = useApi<CatalogItem[]>('/admin/catalog/items?type=lower');
  const shoeItems = useApi<CatalogItem[]>('/admin/catalog/items?type=shoe');
  const item = data?.items.find((entry) => entry.id === id);
  const [label, setLabel] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [replacementUri, setReplacementUri] = useState<string | null>(null);
  const [lowerPickerVisible, setLowerPickerVisible] = useState(false);
  const [shoePickerVisible, setShoePickerVisible] = useState(false);
  const [defaultLowerId, setDefaultLowerId] = useState<string | null>(null);
  const [defaultShoeId, setDefaultShoeId] = useState<string | null>(null);
  const { width: windowWidth } = useWindowDimensions();

  const [poseConfigs, setPoseConfigs] = useState<PoseGarmentConfig[]>([]);
  const [poseConfigsLoading, setPoseConfigsLoading] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<PoseGarmentConfig | null>(null);
  const [editWorkflowId, setEditWorkflowId] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [workflowPickerVisible, setWorkflowPickerVisible] = useState(false);
  const [selectedPoseIds, setSelectedPoseIds] = useState<Set<string>>(new Set());
  const [bulkWorkflowId, setBulkWorkflowId] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkPickerVisible, setBulkPickerVisible] = useState(false);

  useEffect(() => {
    if (!item) return;
    setLabel(item.label);
    setSortOrder(String(item.sortOrder));
  }, [item]);

  useEffect(() => {
    if (!id) return;
    loadPoseConfigs();
    if (workflows.length === 0) {
      apiFetch<WorkflowOption[]>('/admin/workflows')
        .then(setWorkflows)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, workflows.length, loadPoseConfigs]);

  async function loadPoseConfigs() {
    if (!id) return;
    setPoseConfigsLoading(true);
    try {
      const res = await apiFetch<{ items: PoseGarmentConfig[] }>(
        `/admin/assets/garment-types/${id}/pose-configs`,
      );
      setPoseConfigs(res.items);
    } catch {
      // silently fail
    } finally {
      setPoseConfigsLoading(false);
    }
  }

  function openConfigModal(config: PoseGarmentConfig) {
    setEditingConfig(config);
    setEditWorkflowId(config.config?.workflowTemplateId ?? '');
    setEditPrompt(config.config?.promptGarmentPhase ?? '');
    setConfigModalVisible(true);
  }

  function closeConfigModal() {
    setConfigModalVisible(false);
    setEditingConfig(null);
    setEditWorkflowId('');
    setEditPrompt('');
  }

  async function saveConfig() {
    if (!editingConfig || !id) return;
    setEditSaving(true);
    try {
      const body = {
        workflowTemplateId: editWorkflowId || null,
        promptGarmentPhase: editPrompt || null,
        promptFacePhase: null,
      };
      await apiFetch(`/admin/assets/garment-types/${id}/pose-configs/${editingConfig.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setPoseConfigs((prev) =>
        prev.map((p) =>
          p.id === editingConfig.id
            ? { ...p, config: body.workflowTemplateId || body.promptGarmentPhase ? body : null }
            : p,
        ),
      );
      useToastStore.getState().show('Pose config saved', 'success');
      closeConfigModal();
    } catch (cause) {
      Alert.alert('Save failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setEditSaving(false);
    }
  }

  function togglePoseSelection(poseId: string) {
    setSelectedPoseIds((prev) => {
      const next = new Set(prev);
      if (next.has(poseId)) next.delete(poseId);
      else next.add(poseId);
      return next;
    });
  }

  async function applyBulkWorkflow() {
    if (!id || !bulkWorkflowId || selectedPoseIds.size === 0) return;
    setBulkSaving(true);
    try {
      await Promise.all(
        [...selectedPoseIds].map((poseAssetId) => {
          const c = poseConfigs.find((p) => p.id === poseAssetId);
          return apiFetch(`/admin/assets/garment-types/${id}/pose-configs/${poseAssetId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              workflowTemplateId: bulkWorkflowId,
              promptGarmentPhase: c?.config?.promptGarmentPhase ?? null,
              promptFacePhase: null,
            }),
          });
        }),
      );
      useToastStore.getState().show(`Applied workflow to ${selectedPoseIds.size} poses`, 'success');
      setSelectedPoseIds(new Set());
      setBulkWorkflowId('');
      await loadPoseConfigs();
    } catch (cause) {
      Alert.alert(
        'Bulk update failed',
        cause instanceof Error ? cause.message : 'Please try again.',
      );
    } finally {
      setBulkSaving(false);
    }
  }

  async function patchItem(body: object, successMessage = 'Garment type updated') {
    try {
      await apiFetch(`/admin/assets/garment-types/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      useToastStore.getState().show(successMessage, 'success');
      await refresh();
    } catch (cause) {
      const conflict = cause instanceof ApiError && cause.status === 409;
      Alert.alert(
        conflict ? 'Cannot activate' : 'Update failed',
        conflict
          ? 'Upload poses before activating this garment type.'
          : cause instanceof Error
            ? cause.message
            : 'Please try again.',
      );
    }
  }

  async function uploadThumbnail() {
    if (!replacementUri) return;
    try {
      const { thumbnailKey } = await uploadSingleThumb({
        presignEndpoint: '/admin/assets/garment-types/presign',
        presignBody: { contentType: 'image/jpeg' },
        fileUri: replacementUri,
      });
      await patchItem({ thumbnailKey }, 'Thumbnail updated');
      setReplacementUri(null);
    } catch (cause) {
      Alert.alert('Upload failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  function deleteItem() {
    confirmAction({
      title: 'Delete garment type?',
      message: 'This also removes unreferenced poses.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await apiFetch(`/admin/assets/garment-types/${id}`, { method: 'DELETE' });
          useToastStore.getState().show('Garment type deleted', 'success');
          router.back();
        } catch (cause) {
          const conflict = cause instanceof ApiError && cause.status === 409;
          Alert.alert(
            conflict ? 'Cannot delete' : 'Delete failed',
            conflict
              ? 'This garment type has poses referenced by existing jobs.'
              : cause instanceof Error
                ? cause.message
                : 'Please try again.',
          );
        }
      },
    });
  }

  if (loading && !data) {
    return (
      <ScrollView contentContainerStyle={[styles.content, { backgroundColor: colors.bg }]}>
        <Text style={{ color: colors.text }}>Loading…</Text>
      </ScrollView>
    );
  }
  if (error && !data) {
    return (
      <EmptyState
        title="Garment type unavailable"
        message={error.message}
        actionLabel="Retry"
        onAction={() => void refresh()}
      />
    );
  }
  if (!item)
    return (
      <EmptyState title="Garment type not found" message="This garment type does not exist." />
    );

  const thumbnailUri = storageUrl(item.thumbnailKey);
  const activeLowerItems = (lowerItems.data ?? []).filter((x) => x.isActive);
  const activeShoeItems = (shoeItems.data ?? []).filter((x) => x.isActive);

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
        ]}
      >
        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            style={[styles.image, { backgroundColor: colors.surfaceVariant }]}
          />
        ) : null}
        <ImagePickerButton
          label="Replace thumbnail"
          uri={replacementUri}
          onPick={(uri) => setReplacementUri(uri)}
        />
        {replacementUri ? (
          <Button label="Upload thumbnail" onPress={() => void uploadThumbnail()} colors={colors} />
        ) : null}
        <Card colors={colors}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Label</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />
          <Button
            label="Save label"
            onPress={() => void patchItem({ label: label.trim() }, 'Label saved')}
            colors={colors}
          />
        </Card>
        <Card colors={colors}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Slug</Text>
          <Text style={[styles.value, { color: colors.text }]}>{item.slug}</Text>
          <Text style={[styles.help, { color: colors.textMuted }]}>
            Slug editing is not supported by the current API.
          </Text>
        </Card>
        <Card colors={colors}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Gender</Text>
          <Text style={[styles.value, { color: colors.text }]}>{item.genderSlug}</Text>
        </Card>
        <Card colors={colors}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Sort order</Text>
          <TextInput
            keyboardType="number-pad"
            value={sortOrder}
            onChangeText={setSortOrder}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />
          <Button
            label="Save order"
            onPress={() =>
              void patchItem({ sortOrder: Number(sortOrder) || 0 }, 'Sort order saved')
            }
            colors={colors}
          />
        </Card>
        <Toggle
          label="Requires lower upload"
          value={item.requiresLowerUpload}
          onChange={(value) => void patchItem({ requiresLowerUpload: value })}
          colors={colors}
        />
        <Toggle
          label="Active"
          value={item.isActive}
          onChange={(value) => void patchItem({ isActive: value })}
          colors={colors}
        />

        <AccordionSection title="Lower Garment Default">
          <TouchableOpacity
            onPress={() => setLowerPickerVisible(true)}
            style={[
              styles.pickerButton,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.pickerText,
                { color: defaultLowerId ? colors.text : colors.textMuted },
              ]}
            >
              {defaultLowerId
                ? (activeLowerItems.find((x) => x.id === defaultLowerId)?.label ??
                  'Select lower garment')
                : 'Select lower garment'}
            </Text>
            <MaterialCommunityIcons color={colors.textMuted} name="chevron-right" size={20} />
          </TouchableOpacity>
        </AccordionSection>

        <AccordionSection title="Shoe Default">
          <TouchableOpacity
            onPress={() => setShoePickerVisible(true)}
            style={[
              styles.pickerButton,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[styles.pickerText, { color: defaultShoeId ? colors.text : colors.textMuted }]}
            >
              {defaultShoeId
                ? (activeShoeItems.find((x) => x.id === defaultShoeId)?.label ?? 'Select shoe')
                : 'Select shoe'}
            </Text>
            <MaterialCommunityIcons color={colors.textMuted} name="chevron-right" size={20} />
          </TouchableOpacity>
        </AccordionSection>

        <TouchableOpacity
          onPress={() =>
            router.push({ pathname: '/(tabs)/assets/poses', params: { garmentTypeId: item.id } })
          }
          style={[styles.poseButton, { backgroundColor: colors.accentContainer }]}
        >
          <Text style={[styles.value, { color: colors.onAccentContainer }]}>
            {item.poseCount ?? 0} poses
          </Text>
        </TouchableOpacity>
        {canDeleteAssets(role) ? (
          <TouchableOpacity
            onPress={deleteItem}
            style={[styles.deleteButton, { borderColor: colors.error }]}
          >
            <Text style={[styles.buttonText, { color: colors.error }]}>Delete garment type</Text>
          </TouchableOpacity>
        ) : null}

        <AccordionSection title="Pose Configs" initiallyExpanded={false}>
          {poseConfigsLoading ? (
            <Text style={{ color: colors.textSecondary }}>Loading...</Text>
          ) : poseConfigs.length === 0 ? (
            <Text style={{ color: colors.textSecondary }}>No active poses found.</Text>
          ) : (
            <>
              <View style={styles.poseGrid}>
                {poseConfigs.map((pc) => {
                  const cardWidth = (windowWidth - Spacing.lg * 4 - Spacing.md) / 2;
                  const isSelected = selectedPoseIds.has(pc.id);
                  const hasOverride = pc.config !== null;
                  const thumbUri = storageUrl(pc.thumbnailKey);
                  return (
                    <TouchableOpacity
                      key={pc.id}
                      accessibilityRole="button"
                      activeOpacity={0.8}
                      onLongPress={() => togglePoseSelection(pc.id)}
                      onPress={() => {
                        if (selectedPoseIds.size > 0) {
                          togglePoseSelection(pc.id);
                        } else {
                          openConfigModal(pc);
                        }
                      }}
                      style={[
                        styles.poseCard,
                        {
                          width: cardWidth,
                          backgroundColor: colors.surface,
                          borderColor: isSelected ? colors.accent : colors.border,
                        },
                        isSelected && styles.poseCardSelected,
                        !pc.isActive && styles.poseCardInactive,
                      ]}
                    >
                      <View
                        style={[styles.poseImageShell, { backgroundColor: colors.surfaceVariant }]}
                      >
                        {thumbUri ? (
                          <Image
                            contentFit="cover"
                            source={{ uri: thumbUri }}
                            style={styles.poseThumb}
                          />
                        ) : (
                          <MaterialCommunityIcons
                            color={colors.textMuted}
                            name="image-off-outline"
                            size={34}
                          />
                        )}
                        {!pc.isActive ? (
                          <View style={styles.overlay}>
                            <Text style={styles.inactive}>Inactive</Text>
                          </View>
                        ) : null}
                        {isSelected ? (
                          <View style={[styles.check, { backgroundColor: colors.accent }]}>
                            <MaterialCommunityIcons
                              color={colors.onAccent}
                              name="check"
                              size={17}
                            />
                          </View>
                        ) : null}
                        {hasOverride ? (
                          <View
                            style={[
                              styles.overrideTag,
                              { backgroundColor: colors.accentSecondary },
                            ]}
                          >
                            <Text style={styles.overrideTagText}>override</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[styles.poseCardLabel, { color: colors.text }]}
                      >
                        {pc.displayName ?? pc.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {selectedPoseIds.size > 0 ? (
                <View style={[styles.bulkBar, { backgroundColor: colors.surfaceElevated }]}>
                  <Text style={[styles.bulkText, { color: colors.text }]}>
                    {selectedPoseIds.size} selected
                  </Text>
                  <TouchableOpacity onPress={() => setSelectedPoseIds(new Set())}>
                    <Text style={{ color: colors.textSecondary }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setBulkPickerVisible(true)}
                    disabled={bulkSaving}
                  >
                    <Text style={{ color: colors.accent }}>
                      {bulkWorkflowId
                        ? (workflows.find((w) => w.id === bulkWorkflowId)?.label ?? 'Set workflow')
                        : 'Set workflow'}
                    </Text>
                  </TouchableOpacity>
                  {bulkWorkflowId ? (
                    <TouchableOpacity
                      onPress={() => void applyBulkWorkflow()}
                      disabled={bulkSaving}
                    >
                      <Text style={{ color: colors.accent }}>
                        {bulkSaving ? 'Applying...' : 'Apply'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </AccordionSection>
      </ScrollView>

      <PickerModal
        visible={lowerPickerVisible}
        title="Select Lower Garment Default"
        options={activeLowerItems.map((x) => ({
          id: x.id,
          label: x.label,
          subtitle: x.genderSlug ?? undefined,
        }))}
        onClose={() => setLowerPickerVisible(false)}
        onSelect={(selectedId) => {
          void (async () => {
            try {
              await apiFetch(`/admin/assets/garment-types/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ defaultLowerCatalogItemId: selectedId }),
              });
              setDefaultLowerId(selectedId);
              useToastStore.getState().show('Lower garment default saved', 'success');
              await lowerItems.refresh();
            } catch (cause) {
              Alert.alert('Failed', cause instanceof Error ? cause.message : 'Please try again.');
            }
          })();
          setLowerPickerVisible(false);
        }}
      />

      <PickerModal
        visible={shoePickerVisible}
        title="Select Shoe Default"
        options={activeShoeItems.map((x) => ({
          id: x.id,
          label: x.label,
          subtitle: x.genderSlug ?? undefined,
        }))}
        onClose={() => setShoePickerVisible(false)}
        onSelect={(selectedId) => {
          void (async () => {
            try {
              await apiFetch(`/admin/assets/garment-types/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ defaultShoeCatalogItemId: selectedId }),
              });
              setDefaultShoeId(selectedId);
              useToastStore.getState().show('Shoe default saved', 'success');
              await shoeItems.refresh();
            } catch (cause) {
              Alert.alert('Failed', cause instanceof Error ? cause.message : 'Please try again.');
            }
          })();
          setShoePickerVisible(false);
        }}
      />

      <Modal
        animationType="slide"
        onRequestClose={closeConfigModal}
        presentationStyle="pageSheet"
        visible={configModalVisible}
      >
        <ScrollView
          contentContainerStyle={[styles.configModal, { backgroundColor: colors.bg }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.configModalHeader}>
            <Text style={[styles.configModalTitle, { color: colors.text }]}>
              {editingConfig
                ? `${editingConfig.displayName ?? editingConfig.label} \u2014 Override`
                : 'Override'}
            </Text>
            <TouchableOpacity onPress={closeConfigModal} disabled={editSaving}>
              <Text style={[styles.configModalClose, { color: colors.accent }]}>Close</Text>
            </TouchableOpacity>
          </View>

          {editingConfig
            ? (() => {
                const thumbUri = storageUrl(editingConfig.thumbnailKey);
                return thumbUri ? (
                  <Image
                    source={{ uri: thumbUri }}
                    style={[styles.configModalImage, { backgroundColor: colors.surfaceVariant }]}
                  />
                ) : null;
              })()
            : null}

          <Text style={[styles.configFieldLabel, { color: colors.textSecondary }]}>
            Workflow override
          </Text>
          <TouchableOpacity
            onPress={() => setWorkflowPickerVisible(true)}
            disabled={editSaving}
            style={[
              styles.configPickerButton,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={{ color: editWorkflowId ? colors.text : colors.textMuted }}>
              {editWorkflowId
                ? (workflows.find((w) => w.id === editWorkflowId)?.label ?? editWorkflowId)
                : '-- Use default --'}
            </Text>
          </TouchableOpacity>

          <Text style={[styles.configFieldLabel, { color: colors.textSecondary }]}>
            Positive prompt
          </Text>
          <TextInput
            editable={!editSaving}
            multiline
            onChangeText={setEditPrompt}
            placeholder="Inherited from pose"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.configPromptInput,
              { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            value={editPrompt}
          />

          <View style={styles.configModalActions}>
            <TouchableOpacity
              onPress={closeConfigModal}
              disabled={editSaving}
              style={[styles.configModalButton, { borderColor: colors.border }]}
            >
              <Text style={{ color: colors.text }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void saveConfig()}
              disabled={editSaving}
              style={[
                styles.configModalButton,
                { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
            >
              <Text style={{ color: colors.onAccent }}>{editSaving ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Modal>

      <PickerModal
        visible={workflowPickerVisible}
        title="Select workflow"
        options={[
          { id: '', label: '-- Use default --' },
          ...workflows.map((w) => ({ id: w.id, label: w.label })),
        ]}
        onClose={() => setWorkflowPickerVisible(false)}
        onSelect={(selectedId) => {
          setEditWorkflowId(selectedId);
        }}
      />

      <PickerModal
        visible={bulkPickerVisible}
        title="Select workflow"
        options={workflows.map((w) => ({ id: w.id, label: w.label }))}
        onClose={() => setBulkPickerVisible(false)}
        onSelect={(selectedId) => {
          setBulkWorkflowId(selectedId);
        }}
      />
    </>
  );
}

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

function Card({ children, colors }: { children: React.ReactNode; colors: ThemeColors }) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

function Button({
  label,
  onPress,
  colors,
}: {
  label: string;
  onPress: () => void;
  colors: ThemeColors;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.button, { backgroundColor: colors.accent }]}>
      <Text style={[styles.buttonText, { color: colors.onAccent }]}>{label}</Text>
    </TouchableOpacity>
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
  onChange: (value: boolean) => void;
  colors: ThemeColors;
}) {
  return (
    <View style={[styles.toggle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.value, { color: colors.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.lg },
  image: { width: 200, height: 200, alignSelf: 'center', borderRadius: Radius.xl },
  card: { padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.lg, gap: Spacing.md },
  label: { ...Typography.captionBold },
  value: { ...Typography.bodyBold, textTransform: 'capitalize' },
  help: { ...Typography.caption },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    ...Typography.body,
  },
  button: {
    alignSelf: 'flex-end',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  buttonText: { ...Typography.bodyBold },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  poseButton: { padding: Spacing.lg, borderRadius: Radius.lg, alignItems: 'center' },
  deleteButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  pickerText: { ...Typography.body, flex: 1 },

  poseGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  poseCard: { padding: Spacing.sm, borderWidth: 1, borderRadius: Radius.lg, gap: Spacing.sm },
  poseCardSelected: { borderWidth: 2 },
  poseCardInactive: { opacity: 0.55 },
  poseImageShell: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: Radius.md,
  },
  poseThumb: { width: '100%', height: '100%' },
  poseCardLabel: { ...Typography.captionBold },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  inactive: {
    ...Typography.captionBold,
    color: '#FFFFFF',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: Radius.full,
  },
  check: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  overrideTag: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  overrideTagText: { ...Typography.label, color: '#FFFFFF', fontSize: 9 },
  bulkBar: {
    flexDirection: 'row',
    gap: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: Radius.xl,
    marginTop: Spacing.sm,
  },
  bulkText: { ...Typography.bodyBold, flex: 1 },
  configModal: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  configModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  configModalTitle: { ...Typography.h2, flex: 1 },
  configModalClose: { ...Typography.bodyBold },
  configModalImage: {
    width: 120,
    height: 160,
    alignSelf: 'center',
    borderRadius: Radius.lg,
  },
  configFieldLabel: { ...Typography.captionBold },
  configPickerButton: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  configPromptInput: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Typography.body,
    textAlignVertical: 'top',
  },
  configModalActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'flex-end',
    marginTop: Spacing.md,
  },
  configModalButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
});
