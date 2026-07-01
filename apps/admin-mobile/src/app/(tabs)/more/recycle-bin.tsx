import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
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
import { AccordionSection } from '../../../components/AccordionSection';
import { EmptyState } from '../../../components/EmptyState';
import { useApi } from '../../../hooks/useApi';
import { apiFetch } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { canDeleteAssets } from '../../../lib/roles';
import { storageUrl } from '../../../lib/storage';
import { useAuthStore } from '../../../store/auth';
import { useAppTheme } from '../../../store/theme';
import { useToastStore } from '../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../styles/tokens';
import type { ModelBackground, ModelFace, ModelPoseAsset } from '../../../types';

const PAGE_SIZE = 50;

type RecycleType = 'face' | 'background' | 'poseAsset';
type RecycleItem = ModelFace | ModelBackground | ModelPoseAsset;
interface RecycleBinResponse {
  faces: ModelFace[];
  backgrounds: ModelBackground[];
  poseAssets: ModelPoseAsset[];
}

function getGender(item: RecycleItem): string | null {
  if ('gender' in item) return item.gender;
  if ('genderSlug' in item) return item.genderSlug ?? null;
  return null;
}

function getVariant(item: RecycleItem): string | null {
  if ('poseVariant' in item) return item.poseVariant ?? null;
  if ('specialTag' in item) return item.specialTag ?? null;
  return null;
}

export default function RecycleBinScreen() {
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);
  const canPermanentlyDelete = canDeleteAssets(role);
  const recycleBin = useApi<RecycleBinResponse>('/admin/assets/recycle-bin');
  const [selected, setSelected] = useState<Record<RecycleType, Set<string>>>(() => ({
    face: new Set(),
    background: new Set(),
    poseAsset: new Set(),
  }));
  const [emptyConfirm, setEmptyConfirm] = useState('');
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const [emptyError, setEmptyError] = useState<string | null>(null);

  const totalItems = useMemo(
    () =>
      (recycleBin.data?.faces.length ?? 0) +
      (recycleBin.data?.backgrounds.length ?? 0) +
      (recycleBin.data?.poseAssets.length ?? 0),
    [recycleBin.data],
  );

  function toggle(type: RecycleType, id: string) {
    setSelected((current) => {
      const nextSet = new Set(current[type]);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return { ...current, [type]: nextSet };
    });
  }

  function clear(type?: RecycleType) {
    if (type) setSelected((current) => ({ ...current, [type]: new Set() }));
    else setSelected({ face: new Set(), background: new Set(), poseAsset: new Set() });
  }

  async function restore(type: RecycleType) {
    const ids = [...selected[type]];
    if (!ids.length) return;
    try {
      const result = await apiFetch<{ restored: number }>('/admin/assets/recycle-bin/restore', {
        method: 'POST',
        body: JSON.stringify({ type, ids }),
      });
      useToastStore.getState().show(`${result.restored} restored`, 'success');
      clear(type);
      await recycleBin.refresh();
    } catch (cause) {
      Alert.alert('Restore failed', cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  function permanentlyDelete(type: RecycleType, ids = [...selected[type]]) {
    if (!ids.length) return;
    Alert.alert('Delete permanently?', 'Images and database records will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete permanently',
        style: 'destructive',
        onPress: async () => {
          try {
            const result = await apiFetch<{ deleted: number }>('/admin/assets/recycle-bin', {
              method: 'DELETE',
              body: JSON.stringify({ type, ids }),
            });
            useToastStore.getState().show(`${result.deleted} permanently deleted`, 'success');
            clear(type);
            await recycleBin.refresh();
          } catch (cause) {
            Alert.alert(
              'Delete failed',
              cause instanceof Error ? cause.message : 'Please try again.',
            );
          }
        },
      },
    ]);
  }

  async function emptyBin() {
    setEmptying(true);
    setEmptyError(null);
    const groups: [RecycleType, string[]][] = [
      ['face', recycleBin.data?.faces.map((item) => item.id) ?? []],
      ['background', recycleBin.data?.backgrounds.map((item) => item.id) ?? []],
      ['poseAsset', recycleBin.data?.poseAssets.map((item) => item.id) ?? []],
    ].filter((entry) => entry[1].length > 0) as [RecycleType, string[]][];
    try {
      const results = await Promise.all(
        groups.map(([type, ids]) =>
          apiFetch<{ deleted: number }>('/admin/assets/recycle-bin', {
            method: 'DELETE',
            body: JSON.stringify({ type, ids }),
          }),
        ),
      );
      const deleted = results.reduce((sum, result) => sum + result.deleted, 0);
      useToastStore.getState().show(`${deleted} permanently deleted`, 'success');
      clear();
      setShowEmptyConfirm(false);
      setEmptyConfirm('');
      await recycleBin.refresh();
    } catch (cause) {
      const msg =
        cause instanceof Error
          ? cause.message
          : 'Some items may not have been deleted. Refresh and try again.';
      setEmptyError(msg);
      await recycleBin.refresh();
    } finally {
      setEmptying(false);
    }
  }

  if (recycleBin.loading && !recycleBin.data)
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Text style={{ color: colors.textSecondary }}>Loading recycle bin…</Text>
      </View>
    );
  if (recycleBin.error && !recycleBin.data)
    return (
      <EmptyState
        title="Recycle bin unavailable"
        message={recycleBin.error.message}
        actionLabel="Retry"
        onAction={() => void recycleBin.refresh()}
      />
    );

  const data = recycleBin.data ?? { faces: [], backgrounds: [], poseAssets: [] };
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
      ]}
    >
      <View style={styles.summary}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Recycle Bin</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {totalItems} deleted item{totalItems === 1 ? '' : 's'}
          </Text>
        </View>
        {canPermanentlyDelete && totalItems > 0 ? (
          <TouchableOpacity
            onPress={() => {
              setShowEmptyConfirm(true);
              setEmptyConfirm('');
              setEmptyError(null);
            }}
            style={[styles.emptyButton, { borderColor: colors.error }]}
          >
            <Text style={[styles.actionText, { color: colors.error }]}>Empty bin</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {showEmptyConfirm ? (
        <View
          style={[
            styles.emptyConfirmBox,
            { backgroundColor: colors.errorContainer, borderColor: colors.error },
          ]}
        >
          <Text style={[styles.emptyConfirmTitle, { color: colors.error }]}>
            Type DELETE ALL to confirm
          </Text>
          <Text style={{ color: colors.textSecondary, marginBottom: Spacing.sm }}>
            You are about to permanently delete:{'\n'}• {recycleBin.data?.backgrounds.length ?? 0}{' '}
            backgrounds{'\n'}• {recycleBin.data?.faces.length ?? 0} faces{'\n'}•{' '}
            {recycleBin.data?.poseAssets.length ?? 0} pose assets{'\n'}
            This cannot be undone.
          </Text>
          <TextInput
            autoCapitalize="characters"
            autoFocus
            onChangeText={setEmptyConfirm}
            placeholder="DELETE ALL"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.emptyConfirmInput,
              { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            value={emptyConfirm}
          />
          {emptyError ? (
            <Text style={[styles.emptyError, { color: colors.error }]}>{emptyError}</Text>
          ) : null}
          <View style={styles.emptyConfirmActions}>
            <TouchableOpacity
              onPress={() => {
                setShowEmptyConfirm(false);
                setEmptyConfirm('');
                setEmptyError(null);
              }}
              style={[styles.emptyConfirmCancel, { borderColor: colors.border }]}
            >
              <Text style={[styles.actionText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={emptyConfirm !== 'DELETE ALL' || emptying}
              onPress={() => void emptyBin()}
              style={[
                styles.emptyConfirmDelete,
                {
                  backgroundColor:
                    emptyConfirm === 'DELETE ALL' ? colors.error : colors.surfaceVariant,
                  opacity: emptyConfirm === 'DELETE ALL' ? 1 : 0.5,
                },
              ]}
            >
              <Text
                style={[
                  styles.actionText,
                  { color: emptyConfirm === 'DELETE ALL' ? colors.onAccent : colors.textMuted },
                ]}
              >
                {emptying ? 'Emptying...' : `Delete all ${totalItems} items`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {totalItems === 0 ? (
        <EmptyState title="Recycle bin is empty" message="Soft-deleted assets will appear here." />
      ) : null}
      <RecycleSection
        title="Faces"
        type="face"
        items={data.faces}
        selected={selected.face}
        onToggle={toggle}
        onSelectPage={(ids) =>
          setSelected((current) => {
            const s = new Set(current.face);
            ids.forEach((id) => {
              s.add(id);
            });
            return { ...current, face: s };
          })
        }
        onSelectAll={(ids) =>
          setSelected((current) => {
            const s = new Set(current.face);
            ids.forEach((id) => {
              s.add(id);
            });
            return { ...current, face: s };
          })
        }
        onRestore={restore}
        onDelete={permanentlyDelete}
        canDelete={canPermanentlyDelete}
      />
      <RecycleSection
        title="Backgrounds"
        type="background"
        items={data.backgrounds}
        selected={selected.background}
        onToggle={toggle}
        onSelectPage={(ids) =>
          setSelected((current) => {
            const s = new Set(current.background);
            ids.forEach((id) => {
              s.add(id);
            });
            return { ...current, background: s };
          })
        }
        onSelectAll={(ids) =>
          setSelected((current) => {
            const s = new Set(current.background);
            ids.forEach((id) => {
              s.add(id);
            });
            return { ...current, background: s };
          })
        }
        onRestore={restore}
        onDelete={permanentlyDelete}
        canDelete={canPermanentlyDelete}
      />
      <RecycleSection
        title="Pose Assets"
        type="poseAsset"
        items={data.poseAssets}
        selected={selected.poseAsset}
        onToggle={toggle}
        onSelectPage={(ids) =>
          setSelected((current) => {
            const s = new Set(current.poseAsset);
            ids.forEach((id) => {
              s.add(id);
            });
            return { ...current, poseAsset: s };
          })
        }
        onSelectAll={(ids) =>
          setSelected((current) => {
            const s = new Set(current.poseAsset);
            ids.forEach((id) => {
              s.add(id);
            });
            return { ...current, poseAsset: s };
          })
        }
        onRestore={restore}
        onDelete={permanentlyDelete}
        canDelete={canPermanentlyDelete}
      />
    </ScrollView>
  );
}

function RecycleSection({
  title,
  type,
  items,
  selected,
  onToggle,
  onSelectPage,
  onSelectAll,
  onRestore,
  onDelete,
  canDelete,
}: {
  title: string;
  type: RecycleType;
  items: RecycleItem[];
  selected: Set<string>;
  onToggle: (type: RecycleType, id: string) => void;
  onSelectPage: (ids: string[]) => void;
  onSelectAll: (ids: string[]) => void;
  onRestore: (type: RecycleType) => Promise<void>;
  onDelete: (type: RecycleType) => void;
  canDelete: boolean;
}) {
  const { colors } = useAppTheme();
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (!items.length) return null;

  function selectPage() {
    const ids = pageItems.map((item) => item.id);
    onSelectPage(ids);
  }

  function selectAll() {
    const ids = items.map((item) => item.id);
    onSelectAll(ids);
  }

  return (
    <AccordionSection title={`${title} ${items.length}`}>
      <View style={styles.selectBar}>
        <TouchableOpacity onPress={selectPage} style={styles.selectBtn}>
          <Text style={[styles.selectBtnText, { color: colors.accent }]}>Select page</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={selectAll} style={styles.selectBtn}>
          <Text style={[styles.selectBtnText, { color: colors.accent }]}>Select all</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.rows}>
        {pageItems.map((item) => (
          <DeletedRow
            key={item.id}
            item={item}
            selected={selected.has(item.id)}
            onPress={() => onToggle(type, item.id)}
          />
        ))}
      </View>
      {totalPages > 1 ? (
        <View style={styles.pagination}>
          <TouchableOpacity disabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
            <Text style={[styles.pageBtn, { color: page <= 1 ? colors.textMuted : colors.accent }]}>
              Prev
            </Text>
          </TouchableOpacity>
          <Text style={[styles.pageInfo, { color: colors.textSecondary }]}>
            {page} / {totalPages}
          </Text>
          <TouchableOpacity disabled={page >= totalPages} onPress={() => setPage((p) => p + 1)}>
            <Text
              style={[
                styles.pageBtn,
                { color: page >= totalPages ? colors.textMuted : colors.accent },
              ]}
            >
              Next
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {selected.size > 0 ? (
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={() => void onRestore(type)}
            style={[styles.actionButton, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.actionText, { color: colors.onAccent }]}>
              Restore {selected.size}
            </Text>
          </TouchableOpacity>
          {canDelete ? (
            <TouchableOpacity
              onPress={() => onDelete(type)}
              style={[styles.actionButton, { borderColor: colors.error, borderWidth: 1 }]}
            >
              <Text style={[styles.actionText, { color: colors.error }]}>Delete permanently</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </AccordionSection>
  );
}

function DeletedRow({
  item,
  selected,
  onPress,
}: {
  item: RecycleItem;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const thumbnailUri = storageUrl(item.thumbnailKey);
  const label = 'displayName' in item && item.displayName ? item.displayName : item.label;
  const gender = getGender(item);
  const variant = getVariant(item);
  return (
    <TouchableOpacity
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: colors.border }]}
    >
      <MaterialCommunityIcons
        color={selected ? colors.accent : colors.textMuted}
        name={selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
        size={24}
      />
      {thumbnailUri ? (
        <Image source={{ uri: thumbnailUri }} style={styles.thumbnail} />
      ) : (
        <View
          style={[styles.thumbnail, styles.placeholder, { backgroundColor: colors.surfaceVariant }]}
        >
          <MaterialCommunityIcons color={colors.textMuted} name="image-outline" size={20} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowLabel, { color: colors.text }]}>
          {label}
        </Text>
        <Text style={[styles.deletedAt, { color: colors.textSecondary }]}>
          Deleted {item.deletedAt ? formatDate(item.deletedAt) : 'recently'}
        </Text>
      </View>
      {gender ? (
        <View style={[styles.colBadge, { backgroundColor: colors.surfaceVariant }]}>
          <Text style={[styles.colBadgeText, { color: colors.textSecondary }]}>{gender}</Text>
        </View>
      ) : null}
      {variant ? (
        <View style={[styles.colBadge, { backgroundColor: colors.accentContainer }]}>
          <Text style={[styles.colBadgeText, { color: colors.onAccentContainer }]}>{variant}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.lg },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...Typography.h1 },
  subtitle: { ...Typography.caption, marginTop: 2 },
  emptyButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  emptyConfirmBox: {
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
    gap: Spacing.md,
  },
  emptyConfirmTitle: { ...Typography.bodyBold },
  emptyConfirmInput: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    ...Typography.body,
  },
  emptyError: { ...Typography.caption },
  emptyConfirmActions: { flexDirection: 'row', gap: Spacing.md, justifyContent: 'flex-end' },
  emptyConfirmCancel: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  emptyConfirmDelete: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  selectBar: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  selectBtn: { paddingVertical: Spacing.xs },
  selectBtnText: { ...Typography.captionBold },
  rows: { gap: 0 },
  row: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.sm,
  },
  thumbnail: { width: 42, height: 42, borderRadius: Radius.md },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { ...Typography.bodyBold },
  deletedAt: { ...Typography.caption, marginTop: 2 },
  colBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  colBadgeText: { ...Typography.label },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  pageInfo: { ...Typography.caption },
  pageBtn: { ...Typography.captionBold },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingTop: Spacing.lg },
  actionButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.full,
  },
  actionText: { ...Typography.captionBold },
});
