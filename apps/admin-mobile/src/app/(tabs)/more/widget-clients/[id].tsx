import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { apiFetch } from '../../../../lib/api';
import { formatDate } from '../../../../lib/format';
import { isSuperAdmin } from '../../../../lib/roles';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, Typography } from '../../../../styles/tokens';
import type {
  AdminKioskDevice,
  MerchantCatalogItemSummary,
  WidgetClientDetail as WidgetClientDetailType,
} from '../../../../types';

function InfoRow({ label, value }: { label: string; value: string | null }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.text }]}>{value ?? '-'}</Text>
    </View>
  );
}

function SectionButton({
  label,
  icon,
  onPress,
  disabled,
  tone = 'accent',
}: {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'accent' | 'danger' | 'surface';
}) {
  const { colors } = useAppTheme();
  const palette =
    tone === 'danger'
      ? { bg: colors.errorContainer, fg: colors.error }
      : tone === 'surface'
        ? { bg: colors.surfaceVariant, fg: colors.textSecondary }
        : { bg: colors.accent, fg: colors.onAccent };

  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, { backgroundColor: palette.bg }, disabled && { opacity: 0.55 }]}
    >
      <MaterialCommunityIcons color={palette.fg} name={icon} size={18} />
      <Text style={[styles.actionLabel, { color: palette.fg }]}>{label}</Text>
    </TouchableOpacity>
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

  const [kioskEnabled, setKioskEnabled] = useState(false);
  const [maxKioskDevices, setMaxKioskDevices] = useState('5');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [deviceBusyId, setDeviceBusyId] = useState<string | null>(null);

  const [catalogItems, setCatalogItems] = useState<MerchantCatalogItemSummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSavingId, setCatalogSavingId] = useState<string | null>(null);
  const [catalogDrafts, setCatalogDrafts] = useState<
    Record<
      string,
      {
        isActive: boolean;
        moderationStatus: 'approved' | 'rejected';
        moderationNote: string;
      }
    >
  >({});

  async function copyToClipboard(text: string) {
    await Clipboard.setStringAsync(text);
    useToastStore.getState().show('Widget key copied', 'success');
  }

  useEffect(() => {
    if (!client) return;
    setEditCompanyName(client.companyName);
    setEditAllowedOrigins(client.allowedOrigins?.join('\n') ?? '');
    setKioskEnabled(client.kioskEnabled);
    setMaxKioskDevices(String(client.maxKioskDevices));
  }, [client]);

  async function loadCatalog() {
    if (!id) return;
    setCatalogLoading(true);
    try {
      const data = await apiFetch<{ items: MerchantCatalogItemSummary[] }>(
        `/admin/merchant-catalog?widgetClientId=${id}`,
      );
      const items = data.items ?? [];
      setCatalogItems(items);
      setCatalogDrafts(
        Object.fromEntries(
          items.map((item) => [
            item.id,
            {
              isActive: item.isActive,
              moderationStatus: item.moderationStatus,
              moderationNote: item.moderationNote ?? '',
            },
          ]),
        ),
      );
    } catch (cause) {
      Alert.alert(
        'Catalog load failed',
        cause instanceof Error ? cause.message : 'Please try again.',
      );
    } finally {
      setCatalogLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, [id]);

  function showPairingCode(code: string) {
    Alert.alert('Pairing code', `${code}\n\nThis code is shown only once.`);
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
        .map((value) => value.trim())
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

  async function saveKioskSettings() {
    const limit = parseInt(maxKioskDevices, 10);
    if (!limit || limit < 1) {
      Alert.alert('Validation', 'Max kiosk devices must be at least 1.');
      return;
    }
    setActioning(true);
    try {
      await apiFetch(`/v1/admin/widget-clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ kioskEnabled, maxKioskDevices: limit }),
      });
      await refresh();
      useToastStore.getState().show('Kiosk settings updated', 'success');
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
        {
          method: 'POST',
          body: JSON.stringify({ amount, reason: creditReason }),
        },
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

  async function setLinkedUser(userId: string | null) {
    setActioning(true);
    try {
      await apiFetch(`/v1/admin/widget-clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ userId }),
      });
      await refresh();
      useToastStore.getState().show(userId ? 'User linked' : 'User link removed', 'success');
    } catch (cause) {
      Alert.alert('Failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setActioning(false);
    }
  }

  async function createDevice() {
    if (!deviceLabel.trim()) return;
    setActioning(true);
    try {
      const result = await apiFetch<{ device: AdminKioskDevice; pairingCode: string }>(
        `/v1/admin/widget-clients/${id}/kiosk-devices`,
        {
          method: 'POST',
          body: JSON.stringify({ label: deviceLabel.trim() }),
        },
      );
      await refresh();
      setDeviceLabel('');
      showPairingCode(result.pairingCode);
      useToastStore.getState().show('Kiosk device created', 'success');
    } catch (cause) {
      Alert.alert('Failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setActioning(false);
    }
  }

  async function regeneratePairingCode(deviceId: string) {
    setDeviceBusyId(deviceId);
    try {
      const result = await apiFetch<{ device: AdminKioskDevice; pairingCode: string }>(
        `/v1/admin/widget-clients/${id}/kiosk-devices/${deviceId}/pairing-code`,
        { method: 'POST' },
      );
      await refresh();
      showPairingCode(result.pairingCode);
      useToastStore.getState().show('Pairing code generated', 'success');
    } catch (cause) {
      Alert.alert('Failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setDeviceBusyId(null);
    }
  }

  async function revokeDevice(deviceId: string) {
    setDeviceBusyId(deviceId);
    try {
      await apiFetch(`/v1/admin/widget-clients/${id}/kiosk-devices/${deviceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'revoked' }),
      });
      await refresh();
      useToastStore.getState().show('Kiosk device revoked', 'success');
    } catch (cause) {
      Alert.alert('Failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setDeviceBusyId(null);
    }
  }

  function updateCatalogDraft(
    itemId: string,
    patch: Partial<{
      isActive: boolean;
      moderationStatus: 'approved' | 'rejected';
      moderationNote: string;
    }>,
  ) {
    setCatalogDrafts((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...patch },
    }));
  }

  async function saveCatalogItem(itemId: string) {
    const draft = catalogDrafts[itemId];
    if (!draft) return;
    setCatalogSavingId(itemId);
    try {
      const updated = await apiFetch<MerchantCatalogItemSummary>(
        `/admin/merchant-catalog/${itemId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            isActive: draft.isActive,
            moderationStatus: draft.moderationStatus,
            moderationNote: draft.moderationNote.trim() || null,
          }),
        },
      );
      setCatalogItems((prev) => prev.map((item) => (item.id === itemId ? updated : item)));
      setCatalogDrafts((prev) => ({
        ...prev,
        [itemId]: {
          isActive: updated.isActive,
          moderationStatus: updated.moderationStatus,
          moderationNote: updated.moderationNote ?? '',
        },
      }));
      useToastStore.getState().show('Catalog item updated', 'success');
    } catch (cause) {
      Alert.alert('Failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setCatalogSavingId(null);
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

      {superAdmin ? (
        <AccordionSection initiallyExpanded title="Status">
          <SectionButton
            disabled={actioning}
            icon={client.isActive ? 'block-helper' : 'check-circle'}
            label={actioning ? 'Working...' : client.isActive ? 'Deactivate' : 'Activate'}
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
            tone={client.isActive ? 'danger' : 'accent'}
          />
        </AccordionSection>
      ) : null}

      <AccordionSection initiallyExpanded title="Kiosk Access">
        <View style={{ gap: Spacing.sm }}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Enabled</Text>
            <TouchableOpacity
              onPress={() => setKioskEnabled((value) => !value)}
              style={[
                styles.togglePill,
                { backgroundColor: kioskEnabled ? colors.accent : colors.surfaceVariant },
              ]}
            >
              <Text
                style={[
                  styles.toggleLabel,
                  { color: kioskEnabled ? colors.onAccent : colors.textSecondary },
                ]}
              >
                {kioskEnabled ? 'On' : 'Off'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Max kiosk devices</Text>
          <TextInput
            keyboardType="numeric"
            onChangeText={setMaxKioskDevices}
            placeholder="5"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              {
                color: colors.text,
                backgroundColor: colors.surfaceVariant,
                borderColor: colors.border,
              },
            ]}
            value={maxKioskDevices}
          />
          <SectionButton
            disabled={actioning}
            icon="content-save"
            label={actioning ? 'Saving...' : 'Save kiosk settings'}
            onPress={() => void saveKioskSettings()}
          />
        </View>
      </AccordionSection>

      <AccordionSection initiallyExpanded title="Linked User">
        {client.linkedUser ? (
          <View style={{ gap: Spacing.sm }}>
            <Text style={[styles.infoValue, { color: colors.text, textAlign: 'left' }]}>
              {client.linkedUser.displayName || client.linkedUser.email}
            </Text>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
              {client.linkedUser.email}{' '}
              {client.linkedUser.emailVerified ? '(verified)' : '(unverified)'}
            </Text>
            <SectionButton
              disabled={actioning}
              icon="link-off"
              label="Remove Link"
              onPress={() => void setLinkedUser(null)}
              tone="surface"
            />
          </View>
        ) : client.suggestedUser ? (
          <View style={{ gap: Spacing.sm }}>
            <Text style={[styles.infoValue, { color: colors.text, textAlign: 'left' }]}>
              Suggested verified match
            </Text>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
              {client.suggestedUser.displayName || client.suggestedUser.email} (
              {client.suggestedUser.email})
            </Text>
            <SectionButton
              disabled={actioning}
              icon="link-variant"
              label="Confirm link"
              onPress={() => void setLinkedUser(client.suggestedUser!.id)}
            />
          </View>
        ) : (
          <Text style={[styles.infoValue, { color: colors.textMuted, textAlign: 'left' }]}>
            No linked or suggested studio user.
          </Text>
        )}
      </AccordionSection>

      <AccordionSection initiallyExpanded title="Kiosk Devices">
        <View style={{ gap: Spacing.sm }}>
          <TextInput
            onChangeText={setDeviceLabel}
            placeholder="Front counter tablet"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              {
                color: colors.text,
                backgroundColor: colors.surfaceVariant,
                borderColor: colors.border,
              },
            ]}
            value={deviceLabel}
          />
          <SectionButton
            disabled={actioning || !deviceLabel.trim()}
            icon="tablet-dashboard"
            label={actioning ? 'Creating...' : 'Create kiosk device'}
            onPress={() => void createDevice()}
          />

          {client.kioskDevices.length === 0 ? (
            <Text style={[styles.infoValue, { color: colors.textMuted, textAlign: 'left' }]}>
              No kiosk devices created yet.
            </Text>
          ) : (
            client.kioskDevices.map((device) => (
              <View
                key={device.id}
                style={[
                  styles.deviceCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.infoValue, { color: colors.text, textAlign: 'left' }]}>
                    {device.label}
                  </Text>
                  <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                    {device.status} | paired{' '}
                    {device.pairedAt ? formatDate(device.pairedAt) : 'not yet'}
                  </Text>
                </View>
                <View style={{ gap: Spacing.xs }}>
                  <SectionButton
                    disabled={deviceBusyId === device.id || device.status === 'active'}
                    icon="qrcode"
                    label={deviceBusyId === device.id ? 'Working...' : 'Pairing Code'}
                    onPress={() => void regeneratePairingCode(device.id)}
                  />
                  <SectionButton
                    disabled={deviceBusyId === device.id || device.status === 'revoked'}
                    icon="close-octagon"
                    label="Revoke"
                    onPress={() => void revokeDevice(device.id)}
                    tone="danger"
                  />
                </View>
              </View>
            ))
          )}
        </View>
      </AccordionSection>

      {superAdmin ? (
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
            <SectionButton
              disabled={actioning || !creditAmount || !creditReason.trim()}
              icon="plus-circle"
              label={actioning ? 'Adding...' : 'Add Credits'}
              onPress={() => void addCredits()}
            />
          </View>
        </AccordionSection>
      ) : null}

      {client.ledger?.length > 0 ? (
        <AccordionSection
          initiallyExpanded={false}
          title={`Credit Ledger (${client.ledger.length})`}
        >
          {client.ledger.map((entry, index) => (
            <View
              key={entry.id}
              style={[
                styles.ledgerRow,
                index < client.ledger.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoValue, { color: colors.text }]}>{entry.reason}</Text>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                  {formatDate(entry.createdAt)}
                </Text>
              </View>
              <Text
                style={[
                  styles.ledgerDelta,
                  { color: entry.delta > 0 ? colors.success : colors.error },
                ]}
              >
                {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
              </Text>
            </View>
          ))}
        </AccordionSection>
      ) : null}

      <AccordionSection initiallyExpanded title={`Private Catalog (${catalogItems.length})`}>
        {catalogLoading ? (
          <ActivityIndicator color={colors.accent} />
        ) : catalogItems.length === 0 ? (
          <Text style={[styles.infoValue, { color: colors.textMuted, textAlign: 'left' }]}>
            No private catalog items for this merchant yet.
          </Text>
        ) : (
          <View style={{ gap: Spacing.sm }}>
            {catalogItems.map((item) => {
              const draft = catalogDrafts[item.id];
              return (
                <View
                  key={item.id}
                  style={[
                    styles.catalogCard,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.infoValue, { color: colors.text, textAlign: 'left' }]}>
                    {item.label}
                  </Text>
                  <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                    {item.sourceKind === 'imported' ? 'Imported from studio' : 'Direct upload'}
                    {item.category ? ` | ${item.category}` : ''}
                    {item.gender ? ` | ${item.gender}` : ''}
                  </Text>
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Visible</Text>
                    <TouchableOpacity
                      onPress={() =>
                        updateCatalogDraft(item.id, {
                          isActive: !(draft?.isActive ?? item.isActive),
                        })
                      }
                      style={[
                        styles.togglePill,
                        {
                          backgroundColor:
                            (draft?.isActive ?? item.isActive)
                              ? colors.accent
                              : colors.surfaceVariant,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.toggleLabel,
                          {
                            color:
                              (draft?.isActive ?? item.isActive)
                                ? colors.onAccent
                                : colors.textSecondary,
                          },
                        ]}
                      >
                        {(draft?.isActive ?? item.isActive) ? 'On' : 'Off'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                    Moderation Status
                  </Text>
                  <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                    {(['approved', 'rejected'] as const).map((status) => (
                      <TouchableOpacity
                        key={status}
                        onPress={() => updateCatalogDraft(item.id, { moderationStatus: status })}
                        style={[
                          styles.statusChip,
                          {
                            backgroundColor:
                              (draft?.moderationStatus ?? item.moderationStatus) === status
                                ? colors.accent
                                : colors.surfaceVariant,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusChipLabel,
                            {
                              color:
                                (draft?.moderationStatus ?? item.moderationStatus) === status
                                  ? colors.onAccent
                                  : colors.textSecondary,
                            },
                          ]}
                        >
                          {status}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    multiline
                    onChangeText={(value) => updateCatalogDraft(item.id, { moderationNote: value })}
                    placeholder="Moderation note"
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
                    value={draft?.moderationNote ?? item.moderationNote ?? ''}
                  />
                  <SectionButton
                    disabled={catalogSavingId === item.id}
                    icon="content-save"
                    label={catalogSavingId === item.id ? 'Saving...' : 'Save Catalog Item'}
                    onPress={() => void saveCatalogItem(item.id)}
                  />
                </View>
              );
            })}
          </View>
        )}
      </AccordionSection>

      <AccordionSection
        initiallyExpanded
        title={`Recent Jobs${client.recentJobs ? ` (${client.recentJobs.length})` : ''}`}
      >
        {!client.recentJobs || client.recentJobs.length === 0 ? (
          <Text style={[styles.infoValue, { color: colors.textMuted }]}>No jobs yet.</Text>
        ) : (
          client.recentJobs.map((job, index) => (
            <View
              key={job.id}
              style={[
                styles.jobRow,
                index < client.recentJobs.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoValue, { color: colors.text }]}>{job.status}</Text>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                  {formatDate(job.createdAt)} | {job.creditsCharged} credits
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
    alignItems: 'center',
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
  togglePill: {
    minWidth: 58,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    alignItems: 'center',
  },
  toggleLabel: { ...Typography.caption, fontWeight: '700' },
  deviceCard: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  catalogCard: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  statusChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  statusChipLabel: { ...Typography.caption, fontWeight: '700' },
});
