import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { confirmAction } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { ImagePickerButton } from '../../../components/ImagePickerButton';
import { PickerModal } from '../../../components/PickerModal';
import { SkeletonLoader } from '../../../components/SkeletonLoader';
import { UploadProgress } from '../../../components/UploadProgress';
import { useApi } from '../../../hooks/useApi';
import { apiFetch } from '../../../lib/api';
import { canManageTryonSaree } from '../../../lib/roles';
import { type UploadPhase, uploadTwoImage } from '../../../lib/upload';
import { useAuthStore } from '../../../store/auth';
import { useAppTheme } from '../../../store/theme';
import { useToastStore } from '../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../styles/tokens';
import type { TryonCategory, TryonSettings, WorkflowOption } from '../../../types';

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export default function TryonScreen() {
  const role = useAuthStore((state) => state.role);
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const categories = useApi<TryonCategory[]>('/admin/tryon-categories');
  const workflows = useApi<WorkflowOption[]>('/admin/workflows');
  const tryonWorkflows = (workflows.data ?? []).filter((w) => w.workflowType === 'tryon');

  const [samplesVisible, setSamplesVisible] = useState(false);
  const [editing, setEditing] = useState<TryonCategory | null | undefined>(undefined);

  if (!canManageTryonSaree(role))
    return <EmptyState title="Access denied" message="Super admin or moderator only." />;

  function confirmDelete(category: TryonCategory) {
    confirmAction({
      title: 'Delete category',
      message: `Delete "${category.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        await apiFetch(`/admin/tryon-categories/${category.id}`, { method: 'DELETE' });
        useToastStore.getState().show('Category deleted', 'success');
        await categories.refresh();
      },
    });
  }

  if (categories.loading && !categories.data) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg, padding: Spacing.lg }]}>
        <SkeletonLoader count={4} variant="card" />
      </View>
    );
  }
  if (categories.error && !categories.data) {
    return (
      <EmptyState
        title="Try-on categories unavailable"
        message={categories.error.message}
        actionLabel="Retry"
        onAction={() => void categories.refresh()}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.screen,
        { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={categories.loading}
          onRefresh={() => void categories.refresh()}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Try-on Categories</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => setSamplesVisible(true)}
            style={[styles.ghostButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.ghostButtonText, { color: colors.text }]}>Sample images</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setEditing(null)}
            style={[styles.addButton, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.addButtonText, { color: colors.onAccent }]}>+ Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.list}>
        {(categories.data ?? []).map((cat) => {
          const wfLabel = tryonWorkflows.find((w) => w.id === cat.workflowTemplateId)?.label;
          return (
            <View
              key={cat.id}
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
                !cat.isActive && styles.inactive,
              ]}
            >
              <View style={styles.cardHead}>
                <Text numberOfLines={1} style={[styles.cardTitle, { color: colors.text }]}>
                  {cat.name}
                </Text>
                <View
                  style={[
                    styles.smallBadge,
                    {
                      backgroundColor: cat.isActive
                        ? colors.successContainer
                        : colors.surfaceVariant,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      { color: cat.isActive ? colors.success : colors.textMuted },
                    ]}
                  >
                    {cat.isActive ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>
              <View style={styles.cardMetaRow}>
                <Text style={[styles.cardMeta, { color: colors.textMuted }]}>#{cat.sortOrder}</Text>
                <Text style={[styles.cardMeta, styles.mono, { color: colors.textMuted }]}>
                  {cat.slug}
                </Text>
                {wfLabel ? (
                  <Text style={[styles.cardMeta, { color: colors.accent }]}>{wfLabel}</Text>
                ) : null}
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => setEditing(cat)}>
                  <Text style={[styles.linkText, { color: colors.accent }]}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDelete(cat)}>
                  <Text style={[styles.linkText, { color: colors.error }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        {(categories.data ?? []).length === 0 ? (
          <EmptyState
            title="No try-on categories"
            message="Add your first category to get started."
          />
        ) : null}
      </View>

      <SamplesModal visible={samplesVisible} onClose={() => setSamplesVisible(false)} />

      <CategoryModal
        visible={editing !== undefined}
        category={editing ?? null}
        workflows={tryonWorkflows}
        onClose={() => setEditing(undefined)}
        onSuccess={() => void categories.refresh()}
      />
    </ScrollView>
  );
}

function CategoryModal({
  visible,
  category,
  workflows,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  category: TryonCategory | null;
  workflows: WorkflowOption[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { colors } = useAppTheme();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [workflowId, setWorkflowId] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [isActive, setIsActive] = useState(true);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(category?.name ?? '');
    setSlug(category?.slug ?? '');
    setSlugEdited(Boolean(category));
    setWorkflowId(category?.workflowTemplateId ?? '');
    setSortOrder(category ? String(category.sortOrder) : '0');
    setIsActive(category?.isActive ?? true);
  }, [category, visible]);

  function changeName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  async function submit() {
    if (!name.trim() || !slug.trim()) return;
    setSaving(true);
    try {
      if (category) {
        await apiFetch(`/admin/tryon-categories/${category.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: name.trim(),
            workflowTemplateId: workflowId || null,
            sortOrder: Number(sortOrder) || 0,
            isActive,
          }),
        });
        useToastStore.getState().show('Category updated', 'success');
      } else {
        await apiFetch('/admin/tryon-categories', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            slug: slug.trim(),
            // Create schema uses .optional() (not .nullable()) for workflowTemplateId —
            // omit the key entirely rather than sending null.
            ...(workflowId ? { workflowTemplateId: workflowId } : {}),
            sortOrder: Number(sortOrder) || 0,
            isActive,
          }),
        });
        useToastStore.getState().show('Category created', 'success');
      }
      onClose();
      onSuccess();
    } catch (cause) {
      Alert.alert('Save failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const selectedWorkflowLabel = workflows.find((w) => w.id === workflowId)?.label ?? '— none —';

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
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {category ? 'Edit category' : 'Add category'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
            </TouchableOpacity>
          </View>
          <Field label="Name" value={name} onChangeText={changeName} />
          <Field
            label="Slug"
            value={slug}
            editable={!category}
            onChangeText={(v) => {
              setSlugEdited(true);
              setSlug(slugify(v));
            }}
          />
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              Workflow template
            </Text>
            <TouchableOpacity
              onPress={() => setPickerVisible(true)}
              style={[
                styles.select,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
              <Text style={{ color: colors.text }}>{selectedWorkflowLabel}</Text>
            </TouchableOpacity>
          </View>
          <Field label="Sort order" value={sortOrder} onChangeText={setSortOrder} numeric />
          <View
            style={[
              styles.toggleRow,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.toggleLabel, { color: colors.text }]}>Active</Text>
            <Switch value={isActive} onValueChange={setIsActive} />
          </View>
          <TouchableOpacity
            disabled={saving || !name.trim() || !slug.trim()}
            onPress={() => void submit()}
            style={[
              styles.saveButton,
              { backgroundColor: colors.accent },
              (saving || !name.trim() || !slug.trim()) && styles.disabled,
            ]}
          >
            <Text style={[styles.saveButtonText, { color: colors.onAccent }]}>
              {saving ? 'Saving…' : category ? 'Save changes' : 'Create category'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
      <PickerModal
        visible={pickerVisible}
        title="Workflow template"
        options={[
          { id: '', label: '— none —' },
          ...workflows.map((w) => ({
            id: w.id,
            label: w.label,
            subtitle: w.isActive ? undefined : 'inactive',
          })),
        ]}
        onClose={() => setPickerVisible(false)}
        onSelect={setWorkflowId}
      />
    </Modal>
  );
}

function SamplesModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useAppTheme();
  const [settings, setSettings] = useState<TryonSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Record<'person' | 'garment', UploadPhase>>({
    person: null,
    garment: null,
  });
  const [progress, setProgress] = useState<Record<'person' | 'garment', number>>({
    person: 0,
    garment: 0,
  });

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    apiFetch<TryonSettings>('/admin/tryon-settings')
      .then(setSettings)
      .catch(() => useToastStore.getState().show('Failed to load sample images', 'error'))
      .finally(() => setLoading(false));
  }, [visible]);

  async function upload(type: 'person' | 'garment', uri: string, mime: string) {
    try {
      await uploadTwoImage({
        presignEndpoint: '/admin/tryon-settings/presign',
        presignBody: { type, contentType: mime },
        fileUri: uri,
        contentType: mime,
        confirmEndpoint: '/admin/tryon-settings',
        confirmMethod: 'PATCH',
        confirmBody: (keys) =>
          type === 'person'
            ? { personSampleKey: keys.r2Key, personSampleThumbKey: keys.thumbnailKey }
            : { garmentSampleKey: keys.r2Key, garmentSampleThumbKey: keys.thumbnailKey },
        onProgress: (nextPhase, pct) => {
          setPhase((prev) => ({ ...prev, [type]: nextPhase }));
          setProgress((prev) => ({ ...prev, [type]: pct }));
        },
      });
      const updated = await apiFetch<TryonSettings>('/admin/tryon-settings');
      setSettings(updated);
      useToastStore
        .getState()
        .show(`${type === 'person' ? 'Person' : 'Garment'} sample updated`, 'success');
    } catch (cause) {
      Alert.alert('Upload failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setPhase((prev) => ({ ...prev, [type]: null }));
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
        <ScrollView contentContainerStyle={styles.form}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Sample images</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.help, { color: colors.textMuted }]}>
            Shown as reference examples in the try-on upload UI — one for the person photo, one for
            the garment photo.
          </Text>
          {loading ? (
            <SkeletonLoader count={2} variant="card" />
          ) : (
            (['person', 'garment'] as const).map((type) => (
              <View key={type} style={styles.sampleRow}>
                <ImagePickerButton
                  disabled={phase[type] !== null}
                  label={type === 'person' ? 'Person sample' : 'Garment sample'}
                  onPick={(uri, mime) => void upload(type, uri, mime)}
                  size={100}
                  uri={
                    type === 'person'
                      ? (settings?.personSampleUrl ?? null)
                      : (settings?.garmentSampleUrl ?? null)
                  }
                />
                <UploadProgress phase={phase[type]} progress={progress[type]} />
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  numeric,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  numeric?: boolean;
  editable?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        editable={editable}
        keyboardType={numeric ? 'number-pad' : 'default'}
        onChangeText={(v) => onChangeText(numeric ? v.replace(/\D/g, '') : v)}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: editable ? colors.surface : colors.surfaceVariant,
            borderColor: colors.border,
          },
        ]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, gap: Spacing.lg, padding: Spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  title: { ...Typography.h1, flexShrink: 1 },
  headerActions: { flexDirection: 'row', gap: Spacing.sm },
  ghostButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  ghostButtonText: { ...Typography.captionBold },
  addButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  addButtonText: { ...Typography.captionBold },
  list: { gap: Spacing.md },
  card: { gap: Spacing.sm, padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.xl },
  inactive: { opacity: 0.6 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  cardTitle: { ...Typography.bodyBold, flex: 1 },
  cardMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  cardMeta: { ...Typography.caption },
  mono: { fontFamily: 'monospace' },
  cardActions: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.xs },
  linkText: { ...Typography.captionBold },
  smallBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { ...Typography.label },
  modalRoot: { flex: 1 },
  form: { gap: Spacing.lg, padding: Spacing.xl, paddingBottom: Spacing.xxxl },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { ...Typography.h2 },
  close: { ...Typography.bodyBold },
  help: { ...Typography.caption },
  field: { gap: Spacing.sm },
  fieldLabel: { ...Typography.captionBold },
  input: {
    minHeight: 50,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
    ...Typography.body,
  },
  select: {
    minHeight: 50,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  toggleLabel: { ...Typography.bodyBold },
  saveButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  saveButtonText: { ...Typography.bodyBold },
  disabled: { opacity: 0.5 },
  sampleRow: { gap: Spacing.sm },
});
