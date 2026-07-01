import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AccordionSection } from '../../../../components/AccordionSection';
import { confirmAction } from '../../../../components/ConfirmDialog';
import { EmptyState } from '../../../../components/EmptyState';
import { SkeletonLoader } from '../../../../components/SkeletonLoader';
import { StatusBadge } from '../../../../components/StatusBadge';
import { useApi } from '../../../../hooks/useApi';
import { ApiError, apiFetch } from '../../../../lib/api';
import { formatDate, formatNumber } from '../../../../lib/format';
import { isSuperAdmin } from '../../../../lib/roles';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, Typography } from '../../../../styles/tokens';
import type { WidgetClientDetail as WidgetClientDetailType } from '../../../../types';

function InfoRow({ label, value }: { label: string; value: string | null }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.text }]}>{value ?? '—'}</Text>
    </View>
  );
}

export default function WidgetClientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useAppTheme();
  const role = useAuthStore((state) => state.role);
  const superAdmin = isSuperAdmin(role);
  const {
    data: client,
    loading,
    error,
    refresh,
  } = useApi<WidgetClientDetailType>(`/v1/admin/widget-clients/${id}`);

  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [actioning, setActioning] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editAllowedOrigins, setEditAllowedOrigins] = useState('');

  async function copyToClipboard(text: string) {
    await Clipboard.setStringAsync(text);
    useToastStore.getState().show('Widget key copied', 'success');
  }

  function enterEditMode() {
    if (!client) return;
    setEditCompanyName(client.companyName);
    setEditAllowedOrigins(client.allowedOrigins?.join('\n') ?? '');
    setEditMode(true);
  }

  async function saveEdits() {
    if (!client) return;
    setActioning(true);
    try {
      const origins = editAllowedOrigins
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean);
      await apiFetch(`/v1/admin/widget-clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          companyName: editCompanyName.trim(),
          allowedOrigins: origins,
        }),
      });
      await refresh();
      setEditMode(false);
      useToastStore.getState().show('Client updated', 'success');
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setActioning(false);
    }
  }

  async function toggleActive() {
    if (!client) return;
    setActioning(true);
    try {
      await apiFetch(`/v1/admin/widget-clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !client.isActive }),
      });
      await refresh();
      useToastStore
        .getState()
        .show(`Client ${client.isActive ? 'deactivated' : 'activated'}`, 'success');
    } catch (cause) {
      Alert.alert('Failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setActioning(false);
    }
  }

  async function addCredits() {
    const amount = parseInt(creditAmount, 10);
    if (!amount || amount <= 0 || !creditReason.trim()) {
      Alert.alert('Validation', 'Enter a positive amount and reason.');
      return;
    }
    setActioning(true);
    try {
      const result = await apiFetch<{ newBalance: number }>(
        `/v1/admin/widget-clients/${id}/credits`,
        { method: 'POST', body: JSON.stringify({ amount, reason: creditReason }) },
      );
      await refresh();
      setCreditAmount('');
      setCreditReason('');
      useToastStore
        .getState()
        .show(`${amount} credits added. Balance: ${result.newBalance}`, 'success');
    } catch (cause) {
      Alert.alert('Failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setActioning(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg, flex: 1 }]}>
        <SkeletonLoader count={6} variant="detail" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <EmptyState message={error.message} title="Client not found" />
        <TouchableOpacity
          onPress={() => void refresh()}
          style={[styles.retry, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.retryLabel, { color: colors.onAccent }]}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!client) return null;

  return (
    <ScrollView
      contentContainerStyle={[styles.root, { backgroundColor: colors.bg }]}
      style={{ flex: 1 }}
    >
      <View
        style={[styles.header, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.companyName, { color: colors.text }]}>{client.companyName}</Text>
          <Text style={[styles.email, { color: colors.textSecondary }]}>{client.email}</Text>
          <StatusBadge status={client.isActive ? 'ACTIVE' : 'INACTIVE'} />
        </View>
        <Text style={[styles.creditBalance, { color: colors.accent }]}>
          {client.creditBalance ?? 0} credits
        </Text>
      </View>

      <AccordionSection initiallyExpanded title="Info">
        <InfoRow label="Contact" value={client.contactName} />
        <InfoRow label="Phone" value={client.phone} />
        <InfoRow label="Website" value={client.websiteUrl} />
        <InfoRow label="Company Size" value={client.companySize} />
        <InfoRow label="Purpose" value={client.purpose} />
        <InfoRow label="Address" value={client.businessAddress} />
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Widget Key</Text>
          <View style={styles.keyRow}>
            <Text style={[styles.infoValue, { color: colors.text, flex: 0 }]}>
              {client.widgetKey}
            </Text>
            <TouchableOpacity
              onPress={() => copyToClipboard(client.widgetKey)}
              style={styles.copyBtn}
            >
              <MaterialCommunityIcons color={colors.accent} name="content-copy" size={16} />
            </TouchableOpacity>
          </View>
        </View>
        <InfoRow label="Created" value={formatDate(client.createdAt)} />
        <InfoRow
          label="Allowed Origins"
          value={client.allowedOrigins?.length ? client.allowedOrigins.join(', ') : '(none)'}
        />
      </AccordionSection>

      {editMode ? (
        <AccordionSection initiallyExpanded title="Edit Client">
          <View style={{ gap: Spacing.sm }}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Company Name</Text>
            <TextInput
              onChangeText={setEditCompanyName}
              placeholder="Company name"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.surfaceVariant,
                  borderColor: colors.border,
                },
              ]}
              value={editCompanyName}
            />
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
              Allowed Origins (one per line)
            </Text>
            <TextInput
              multiline
              onChangeText={setEditAllowedOrigins}
              placeholder="https://example.com"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                styles.multilineInput,
                {
                  color: colors.text,
                  backgroundColor: colors.surfaceVariant,
                  borderColor: colors.border,
                },
              ]}
              value={editAllowedOrigins}
            />
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TouchableOpacity
                disabled={actioning}
                onPress={() => void saveEdits()}
                style={[styles.actionButton, { backgroundColor: colors.accent, flex: 1 }]}
              >
                {actioning ? (
                  <ActivityIndicator color={colors.onAccent} size="small" />
                ) : (
                  <MaterialCommunityIcons color={colors.onAccent} name="content-save" size={20} />
                )}
                <Text style={[styles.actionLabel, { color: colors.onAccent }]}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setEditMode(false)}
                style={[styles.actionButton, { backgroundColor: colors.surfaceVariant, flex: 1 }]}
              >
                <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </AccordionSection>
      ) : (
        <TouchableOpacity
          onPress={enterEditMode}
          style={[styles.editToggle, { backgroundColor: colors.accentContainer }]}
        >
          <MaterialCommunityIcons color={colors.onAccentContainer} name="pencil" size={18} />
          <Text style={[styles.actionLabel, { color: colors.onAccentContainer }]}>Edit Client</Text>
        </TouchableOpacity>
      )}

      {superAdmin && (
        <AccordionSection initiallyExpanded title="Status">
          <TouchableOpacity
            disabled={actioning}
            onPress={() => {
              confirmAction({
                title: client.isActive ? 'Deactivate client?' : 'Activate client?',
                message: client.isActive
                  ? 'The widget will stop working.'
                  : 'The widget will be usable again.',
                confirmLabel: client.isActive ? 'Deactivate' : 'Activate',
                destructive: client.isActive,
                onConfirm: () => void toggleActive(),
              });
            }}
            style={[
              styles.actionButton,
              {
                backgroundColor: client.isActive ? colors.errorContainer : colors.successContainer,
              },
            ]}
          >
            <MaterialCommunityIcons
              color={client.isActive ? colors.error : colors.success}
              name={client.isActive ? 'block-helper' : 'check-circle'}
              size={20}
            />
            <Text
              style={[
                styles.actionLabel,
                { color: client.isActive ? colors.error : colors.success },
              ]}
            >
              {actioning ? 'Working…' : client.isActive ? 'Deactivate' : 'Activate'}
            </Text>
          </TouchableOpacity>
        </AccordionSection>
      )}

      {superAdmin && (
        <AccordionSection initiallyExpanded title="Add Credits">
          <View style={{ gap: Spacing.sm }}>
            <View
              style={[
                styles.field,
                { backgroundColor: colors.surfaceVariant, borderColor: colors.border },
              ]}
            >
              <TextInput
                editable={!actioning}
                keyboardType="numeric"
                onChangeText={setCreditAmount}
                placeholder="Amount"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.text }]}
                value={creditAmount}
              />
            </View>
            <View
              style={[
                styles.field,
                { backgroundColor: colors.surfaceVariant, borderColor: colors.border },
              ]}
            >
              <TextInput
                editable={!actioning}
                onChangeText={setCreditReason}
                placeholder="Reason (e.g. Trial grant)"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.text }]}
                value={creditReason}
              />
            </View>
            <TouchableOpacity
              disabled={actioning || !creditAmount || !creditReason.trim()}
              onPress={() => void addCredits()}
              style={[
                styles.actionButton,
                { backgroundColor: colors.accent },
                (actioning || !creditAmount || !creditReason.trim()) && { opacity: 0.5 },
              ]}
            >
              {actioning ? (
                <ActivityIndicator color={colors.onAccent} size="small" />
              ) : (
                <MaterialCommunityIcons color={colors.onAccent} name="plus-circle" size={20} />
              )}
              <Text style={[styles.actionLabel, { color: colors.onAccent }]}>
                {actioning ? 'Adding…' : 'Add Credits'}
              </Text>
            </TouchableOpacity>
          </View>
        </AccordionSection>
      )}

      {client.ledger && client.ledger.length > 0 && (
        <AccordionSection
          initiallyExpanded={false}
          title={`Credit Ledger (${client.ledger.length})`}
        >
          {client.ledger.map((l: WidgetClientDetailType['ledger'][0], i: number) => (
            <View
              key={l.id}
              style={[
                styles.ledgerRow,
                i < client.ledger.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoValue, { color: colors.text }]}>{l.reason}</Text>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                  {formatDate(l.createdAt)}
                </Text>
              </View>
              <Text
                style={[styles.ledgerDelta, { color: l.delta > 0 ? colors.success : colors.error }]}
              >
                {l.delta > 0 ? `+${l.delta}` : l.delta}
              </Text>
            </View>
          ))}
        </AccordionSection>
      )}

      <AccordionSection
        initiallyExpanded
        title={`Recent Jobs${client.recentJobs ? ` (${client.recentJobs.length})` : ''}`}
      >
        {!client.recentJobs || client.recentJobs.length === 0 ? (
          <Text style={[styles.infoValue, { color: colors.textMuted }]}>No jobs yet.</Text>
        ) : (
          client.recentJobs.map((j: WidgetClientDetailType['recentJobs'][0], i: number) => (
            <View
              key={j.id}
              style={[
                styles.jobRow,
                i < client.recentJobs.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoValue, { color: colors.text }]}>{j.status}</Text>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                  {formatDate(j.createdAt)} · {j.creditsCharged} credits
                </Text>
              </View>
            </View>
          ))
        )}
      </AccordionSection>

      <View style={{ height: Spacing.xxxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: Spacing.lg, gap: Spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  companyName: { ...Typography.h3 },
  email: { ...Typography.caption, marginTop: 2 },
  creditBalance: { ...Typography.h2 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    gap: Spacing.sm,
  },
  infoLabel: { ...Typography.caption, flexShrink: 0 },
  infoValue: { ...Typography.body, flex: 1, textAlign: 'right' },
  keyRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.xs,
  },
  copyBtn: { padding: 4 },
  editToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.full,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.full,
  },
  actionLabel: { ...Typography.bodyBold },
  field: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  input: {
    ...Typography.body,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
  },
  multilineInput: { minHeight: 100, textAlignVertical: 'top', paddingVertical: Spacing.md },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  ledgerDelta: { ...Typography.bodyBold },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  retry: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    marginTop: Spacing.lg,
    alignSelf: 'center',
  },
  retryLabel: { ...Typography.bodyBold },
});
