import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
import { useApi } from '../../../hooks/useApi';
import { apiFetch } from '../../../lib/api';
import { isSuperAdmin } from '../../../lib/roles';
import { useAuthStore } from '../../../store/auth';
import { useAppTheme } from '../../../store/theme';
import { useToastStore } from '../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../styles/tokens';
import type { ResolutionConfig, SystemConfig } from '../../../types';

const RESOLUTIONS = ['HD', '2K', '4K'] as const;
const DEFAULT_RESOLUTIONS: Record<(typeof RESOLUTIONS)[number], ResolutionConfig> = {
  HD: { enabled: false, creditCost: 10 },
  '2K': { enabled: true, creditCost: 25 },
  '4K': { enabled: true, creditCost: 40 },
};

export default function SystemConfigScreen() {
  const role = useAuthStore((state) => state.role);
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const config = useApi<SystemConfig>('/admin/config');
  const [creditCost, setCreditCost] = useState('');
  const [maxJobs, setMaxJobs] = useState('');
  const [freeTrialCredits, setFreeTrialCredits] = useState('');
  const [resolutions, setResolutions] = useState(DEFAULT_RESOLUTIONS);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (config.data) {
      setCreditCost(String(config.data.creditCostPerJob));
      setMaxJobs(String(config.data.maxJobsPerDay));
      setFreeTrialCredits(String(config.data.freeTrialCredits ?? 0));
      setResolutions({ ...DEFAULT_RESOLUTIONS, ...config.data.resolutions });
    }
  }, [config.data]);
  const dirty = useMemo(
    () =>
      Boolean(config.data) &&
      (creditCost !== String(config.data?.creditCostPerJob) ||
        maxJobs !== String(config.data?.maxJobsPerDay) ||
        freeTrialCredits !== String(config.data?.freeTrialCredits ?? 0) ||
        JSON.stringify(resolutions) !==
          JSON.stringify({ ...DEFAULT_RESOLUTIONS, ...config.data?.resolutions })),
    [config.data, creditCost, maxJobs, freeTrialCredits, resolutions],
  );

  if (!isSuperAdmin(role)) return <EmptyState title="Access denied" message="Super admin only." />;
  if (config.error && !config.data)
    return (
      <EmptyState
        title="Config unavailable"
        message={config.error.message}
        actionLabel="Retry"
        onAction={() => void config.refresh()}
      />
    );

  async function save() {
    const creditCostPerJob = Number(creditCost);
    const maxJobsPerDay = Number(maxJobs);
    const freeTrialCreditsValue = Number(freeTrialCredits);
    if (
      !Number.isInteger(creditCostPerJob) ||
      creditCostPerJob < 1 ||
      creditCostPerJob > 100 ||
      !Number.isInteger(maxJobsPerDay) ||
      maxJobsPerDay < 1 ||
      maxJobsPerDay > 10_000
    )
      return Alert.alert(
        'Invalid config',
        'Credit cost must be 1–100 and max jobs must be 1–10,000.',
      );
    if (
      !Number.isInteger(freeTrialCreditsValue) ||
      freeTrialCreditsValue < 0 ||
      freeTrialCreditsValue > 10_000
    )
      return Alert.alert('Invalid config', 'Free trial credits must be 0–10,000.');
    for (const res of RESOLUTIONS) {
      const cost = resolutions[res].creditCost;
      if (!Number.isInteger(cost) || cost < 1 || cost > 1_000)
        return Alert.alert('Invalid config', `${res} credit cost must be 1–1,000.`);
    }
    setSaving(true);
    try {
      await apiFetch('/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({
          creditCostPerJob,
          maxJobsPerDay,
          freeTrialCredits: freeTrialCreditsValue,
          resolutions,
        }),
      });
      useToastStore.getState().show('Config saved', 'success');
      await config.refresh();
    } catch (cause) {
      Alert.alert('Save failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function refresh() {
    if (!dirty) {
      void config.refresh();
      return;
    }
    confirmAction({
      title: 'Discard changes?',
      message: 'Refreshing will replace your unsaved values.',
      confirmLabel: 'Discard and refresh',
      destructive: true,
      onConfirm: () => config.refresh(),
    });
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
      ]}
      refreshControl={
        <RefreshControl refreshing={config.loading} onRefresh={refresh} tintColor={colors.accent} />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>System Config</Text>
          <Text style={[styles.subtitle, { color: dirty ? colors.warning : colors.textSecondary }]}>
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </Text>
        </View>
      </View>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Field label="Credit Cost Per Job" value={creditCost} onChange={setCreditCost} />
        <Field label="Max Jobs Per Day" value={maxJobs} onChange={setMaxJobs} />
        <Field label="Free Trial Credits" value={freeTrialCredits} onChange={setFreeTrialCredits} />
      </View>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text }]}>Resolution Pricing</Text>
        {RESOLUTIONS.map((res) => (
          <View key={res} style={styles.resolutionRow}>
            <Switch
              onValueChange={(enabled) =>
                setResolutions((prev) => ({ ...prev, [res]: { ...prev[res], enabled } }))
              }
              value={resolutions[res].enabled}
            />
            <Text style={[styles.resolutionLabel, { color: colors.text }]}>{res}</Text>
            <TextInput
              editable={resolutions[res].enabled}
              keyboardType="number-pad"
              onChangeText={(value) =>
                setResolutions((prev) => ({
                  ...prev,
                  [res]: { ...prev[res], creditCost: Number(value.replace(/\D/g, '')) || 0 },
                }))
              }
              style={[
                styles.resolutionInput,
                {
                  color: colors.text,
                  backgroundColor: colors.bgSecondary,
                  borderColor: colors.border,
                  opacity: resolutions[res].enabled ? 1 : 0.5,
                },
              ]}
              value={String(resolutions[res].creditCost)}
            />
            <Text style={[styles.help, { color: colors.textMuted }]}>credits/image</Text>
          </View>
        ))}
      </View>
      <TouchableOpacity
        disabled={!dirty || saving}
        onPress={() => void save()}
        style={[
          styles.saveButton,
          { backgroundColor: colors.accent },
          (!dirty || saving) && styles.disabled,
        ]}
      >
        <Text style={[styles.saveText, { color: colors.onAccent }]}>Save changes</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <TextInput
        keyboardType="number-pad"
        onChangeText={(value) => onChange(value.replace(/\D/g, ''))}
        style={[
          styles.input,
          { color: colors.text, backgroundColor: colors.bgSecondary, borderColor: colors.border },
        ]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: Spacing.lg, padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...Typography.h1 },
  subtitle: { ...Typography.captionBold, marginTop: 2 },
  card: { gap: Spacing.xl, padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.xl },
  field: { gap: Spacing.sm },
  label: { ...Typography.bodyBold },
  input: {
    minHeight: 52,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
    ...Typography.h3,
    fontVariant: ['tabular-nums'],
  },
  help: { ...Typography.caption },
  resolutionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  resolutionLabel: { ...Typography.bodyBold, width: 32 },
  resolutionInput: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
    textAlign: 'right',
    ...Typography.body,
  },
  saveButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  saveText: { ...Typography.bodyBold },
  disabled: { opacity: 0.45 },
});
