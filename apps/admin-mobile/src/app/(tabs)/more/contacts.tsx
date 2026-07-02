import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
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
import { EmptyState } from '../../../components/EmptyState';
import { apiFetch } from '../../../lib/api';
import { useAppTheme } from '../../../store/theme';
import { useToastStore } from '../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../styles/tokens';
import type { ContactRequest, ContactSourcesSummary } from '../../../types';

const STATUS_LABEL: Record<string, string> = { new: 'New', read: 'Read', done: 'Done' };
const SOURCE_LABELS: Record<string, string> = {
  'app-support': 'App Support',
  'Integrate with Website': 'Integration',
  'Retail Store Kiosk': 'Retail / Kiosk',
  __null__: 'General',
};

function sourceKey(src: string | null) {
  return src === null ? '__null__' : src;
}

const STATUS_FILTERS = ['all', 'new', 'read', 'done'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function ContactsScreen() {
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const [rows, setRows] = useState<ContactRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [summary, setSummary] = useState<ContactSourcesSummary>({
    sources: [],
    newBySource: {},
    totalBySource: {},
  });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ContactRequest | null>(null);

  const load = useCallback(async (status: string, source: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ status, limit: '100' });
      if (source !== 'all') params.set('source', source);
      const data = await apiFetch<{ rows: ContactRequest[]; total: number }>(
        `/admin/contact-requests?${params.toString()}`,
      );
      setRows(data.rows);
      setTotal(data.total);
    } catch {
      if (!silent) useToastStore.getState().show('Failed to load contact requests', 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const refreshSummary = useCallback(async () => {
    const data = await apiFetch<ContactSourcesSummary>('/admin/contact-requests/sources').catch(
      () => null,
    );
    if (data) setSummary(data);
  }, []);

  useEffect(() => {
    void load(statusFilter, sourceFilter);
    void refreshSummary();
    const poll = setInterval(() => {
      void load(statusFilter, sourceFilter, true);
      void refreshSummary();
    }, 5_000);
    return () => clearInterval(poll);
  }, [load, refreshSummary, statusFilter, sourceFilter]);

  async function setStatus(id: string, status: ContactRequest['status']) {
    try {
      const updated = await apiFetch<ContactRequest>(`/admin/contact-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setSelected((prev) => (prev?.id === id ? updated : prev));
      useToastStore.getState().show(`Marked as ${STATUS_LABEL[status]}`, 'success');
      void refreshSummary();
    } catch {
      useToastStore.getState().show('Failed to update status', 'error');
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? rows.filter(
            (r) =>
              r.name.toLowerCase().includes(q) ||
              r.email.toLowerCase().includes(q) ||
              r.message?.toLowerCase().includes(q),
          )
        : rows,
    [rows, q],
  );

  const totalNew = summary.newBySource.__total__ ?? 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={[styles.screen, { paddingBottom: bottom + TabBarClearance }]}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load(statusFilter, sourceFilter)}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>Contact Requests</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{total} total</Text>
          </View>
          {totalNew > 0 ? (
            <View style={[styles.newBadge, { backgroundColor: colors.error }]}>
              <Text style={styles.newBadgeText}>{totalNew} new</Text>
            </View>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <SourceChip
            active={sourceFilter === 'all'}
            label="All channels"
            count={totalNew}
            onPress={() => {
              setSourceFilter('all');
              setStatusFilter('all');
            }}
          />
          {summary.sources.map((src) => {
            const key = sourceKey(src);
            const label = SOURCE_LABELS[key] ?? src ?? 'General';
            return (
              <SourceChip
                key={key}
                active={sourceFilter === key}
                label={label}
                count={summary.newBySource[key] ?? 0}
                onPress={() => {
                  setSourceFilter(key);
                  setStatusFilter('all');
                }}
              />
            );
          })}
        </ScrollView>

        <View style={styles.chipRow}>
          {STATUS_FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setStatusFilter(f)}
              style={[
                styles.statusChip,
                {
                  backgroundColor:
                    statusFilter === f ? colors.accentContainer : colors.surfaceVariant,
                  borderColor: statusFilter === f ? colors.accent : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusChipText,
                  { color: statusFilter === f ? colors.onAccentContainer : colors.textSecondary },
                ]}
              >
                {f === 'all' ? 'All' : STATUS_LABEL[f]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          onChangeText={setSearch}
          placeholder="Search name, email…"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.search,
            { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          value={search}
        />

        <View style={styles.list}>
          {filtered.map((r) => (
            <TouchableOpacity
              key={r.id}
              onPress={() => setSelected(r)}
              style={[
                styles.row,
                {
                  backgroundColor: r.status === 'new' ? colors.errorContainer : colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.rowHead}>
                <Text numberOfLines={1} style={[styles.rowName, { color: colors.text }]}>
                  {r.name}
                </Text>
                <Text style={[styles.rowDate, { color: colors.textMuted }]}>
                  {new Date(r.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </Text>
              </View>
              <Text numberOfLines={2} style={[styles.rowMessage, { color: colors.textSecondary }]}>
                {r.message || 'No message'}
              </Text>
              <View style={styles.rowFoot}>
                <Text style={[styles.sourceTag, { color: colors.accent }]}>
                  {SOURCE_LABELS[sourceKey(r.source)] ?? r.source ?? 'General'}
                </Text>
                <Text style={[styles.statusTag, { color: colors.textMuted }]}>
                  {STATUS_LABEL[r.status]}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
          {!loading && filtered.length === 0 ? (
            <EmptyState
              title="No contact requests"
              message={
                search ? `No results for "${search}"` : 'Nothing matches the selected filters.'
              }
            />
          ) : null}
        </View>
      </ScrollView>

      <DetailModal contact={selected} onClose={() => setSelected(null)} onSetStatus={setStatus} />
    </View>
  );
}

function SourceChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.sourceChip,
        { backgroundColor: colors.surface, borderColor: active ? colors.accent : colors.border },
      ]}
    >
      <Text style={[styles.sourceChipLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.sourceChipCount, { color: count > 0 ? colors.error : colors.text }]}>
        {count}
      </Text>
    </TouchableOpacity>
  );
}

function DetailModal({
  contact,
  onClose,
  onSetStatus,
}: {
  contact: ContactRequest | null;
  onClose: () => void;
  onSetStatus: (id: string, status: ContactRequest['status']) => void;
}) {
  const { colors } = useAppTheme();
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function copy(text: string, key: string) {
    void Clipboard.setStringAsync(text);
    setCopied(key);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1500);
  }

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={!!contact}
      onRequestClose={onClose}
    >
      {contact ? (
        <View style={[styles.modalRoot, { backgroundColor: colors.bg }]}>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <View style={styles.modalHeader}>
              <View style={styles.flex}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>{contact.name}</Text>
                <Text style={[styles.modalDate, { color: colors.textMuted }]}>
                  {new Date(contact.createdAt).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose}>
                <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.infoCard, { backgroundColor: colors.surfaceVariant }]}>
              <InfoRow
                label="Email"
                value={contact.email}
                copied={copied === 'email'}
                onCopy={() => copy(contact.email, 'email')}
                onOpen={() =>
                  Linking.openURL(`mailto:${contact.email}?subject=Re: Your enquiry via Aivastra`)
                }
              />
              <InfoRow
                label="Phone"
                value={contact.phone}
                copied={copied === 'phone'}
                onCopy={() => copy(contact.phone, 'phone')}
                onOpen={() => Linking.openURL(`tel:${contact.phone}`)}
              />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Source</Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {SOURCE_LABELS[sourceKey(contact.source)] ?? contact.source ?? 'General'}
                </Text>
              </View>
            </View>

            {contact.message ? (
              <View>
                <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Message</Text>
                <Text
                  style={[
                    styles.message,
                    {
                      color: colors.text,
                      backgroundColor: colors.surfaceVariant,
                      borderLeftColor: colors.accent,
                    },
                  ]}
                >
                  {contact.message}
                </Text>
              </View>
            ) : (
              <Text style={[styles.noMessage, { color: colors.textMuted }]}>
                No message included
              </Text>
            )}
          </ScrollView>

          <View style={[styles.modalFoot, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              onPress={() =>
                Linking.openURL(`mailto:${contact.email}?subject=Re: Your enquiry via Aivastra`)
              }
              style={[styles.footButton, { backgroundColor: colors.accentContainer }]}
            >
              <Text style={[styles.footButtonText, { color: colors.onAccentContainer }]}>
                Reply by email
              </Text>
            </TouchableOpacity>
            {contact.status === 'new' ? (
              <TouchableOpacity
                onPress={() => onSetStatus(contact.id, 'read')}
                style={[styles.footButton, { backgroundColor: colors.surfaceVariant }]}
              >
                <Text style={[styles.footButtonText, { color: colors.text }]}>Mark read</Text>
              </TouchableOpacity>
            ) : null}
            {contact.status !== 'done' ? (
              <TouchableOpacity
                onPress={() => onSetStatus(contact.id, 'done')}
                style={[styles.footButton, { backgroundColor: colors.accent }]}
              >
                <Text style={[styles.footButtonText, { color: colors.onAccent }]}>Mark done</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => onSetStatus(contact.id, 'new')}
                style={[styles.footButton, { backgroundColor: colors.surfaceVariant }]}
              >
                <Text style={[styles.footButtonText, { color: colors.text }]}>Reopen</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

function InfoRow({
  label,
  value,
  copied,
  onCopy,
  onOpen,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  onOpen: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.textMuted }]}>{label}</Text>
      <TouchableOpacity onPress={onOpen} style={styles.flex}>
        <Text numberOfLines={1} style={[styles.infoValue, styles.mono, { color: colors.accent }]}>
          {value}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCopy}>
        <Text style={[styles.copyLabel, { color: colors.textMuted }]}>
          {copied ? 'Copied' : 'Copy'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  screen: { gap: Spacing.md, padding: Spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  title: { ...Typography.h1 },
  subtitle: { ...Typography.caption, marginTop: 2 },
  newBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  newBadgeText: { ...Typography.captionBold, color: '#fff' },
  chipRow: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.xs },
  sourceChip: {
    minWidth: 110,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
    gap: 2,
  },
  sourceChipLabel: { ...Typography.caption },
  sourceChipCount: { ...Typography.h3 },
  statusChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  statusChipText: { ...Typography.captionBold },
  search: {
    minHeight: 46,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.full,
    ...Typography.body,
  },
  list: { gap: Spacing.sm },
  row: { padding: Spacing.md, borderWidth: 1, borderRadius: Radius.lg, gap: Spacing.xs },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  rowName: { ...Typography.bodyBold, flex: 1 },
  rowDate: { ...Typography.caption },
  rowMessage: { ...Typography.caption },
  rowFoot: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  sourceTag: { ...Typography.label },
  statusTag: { ...Typography.label },
  modalRoot: { flex: 1 },
  modalBody: { gap: Spacing.lg, padding: Spacing.xl },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  flex: { flex: 1, minWidth: 0 },
  modalTitle: { ...Typography.h2 },
  modalDate: { ...Typography.caption, marginTop: 2 },
  close: { ...Typography.bodyBold },
  infoCard: { borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  infoLabel: { ...Typography.caption, width: 50 },
  infoValue: { ...Typography.body, flex: 1 },
  mono: { fontFamily: 'monospace' },
  copyLabel: { ...Typography.captionBold },
  sectionLabel: { ...Typography.label, marginBottom: Spacing.sm },
  message: {
    ...Typography.body,
    lineHeight: 22,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    borderLeftWidth: 3,
  },
  noMessage: {
    ...Typography.body,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },
  modalFoot: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderTopWidth: 1,
  },
  footButton: {
    flexGrow: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
  },
  footButtonText: { ...Typography.bodyBold },
});
