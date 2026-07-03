import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccordionSection } from '../../../components/AccordionSection';
import { confirmAction } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { NotificationsSection } from '../../../components/NotificationsSection';
import { useApi } from '../../../hooks/useApi';
import { ApiError, apiFetch } from '../../../lib/api';
import { isSuperAdmin } from '../../../lib/roles';
import { useAuthStore } from '../../../store/auth';
import { useLocalSettings } from '../../../store/settings';
import { useAppTheme } from '../../../store/theme';
import { useToastStore } from '../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../styles/tokens';
import type { CreditPlan } from '../../../types';

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100] as const;


function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function SettingsScreen() {
  const role = useAuthStore((state) => state.role);
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const localSettings = useLocalSettings();
  const plans = useApi<CreditPlan[]>('/admin/credit-plans');
  const [editing, setEditing] = useState<CreditPlan | null | undefined>(undefined);

  useEffect(() => {
    void localSettings.load();
  }, [localSettings]);

  if (!isSuperAdmin(role)) return <EmptyState title="Access denied" message="Super admin only." />;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.screen,
        { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
      </View>

      <AccordionSection title="Appearance">
        <View style={styles.sectionContent}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Page size</Text>
          <View style={styles.chipRow}>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <TouchableOpacity
                key={size}
                onPress={() => void localSettings.update({ pageSize: size })}
                style={[
                  styles.chip,
                  {
                    backgroundColor:
                      localSettings.pageSize === size
                        ? colors.accentContainer
                        : colors.surfaceVariant,
                    borderColor: localSettings.pageSize === size ? colors.accent : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    {
                      color:
                        localSettings.pageSize === size
                          ? colors.onAccentContainer
                          : colors.textSecondary,
                    },
                  ]}
                >
                  {size}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

        </View>
      </AccordionSection>

      <AccordionSection title="Notifications" initiallyExpanded={false}>
        <View style={styles.sectionContent}>
          <NotificationsSection />
        </View>
      </AccordionSection>

      <AccordionSection title="Credit Plans">
        {plans.error && !plans.data ? (
          <EmptyState
            title="Credit plans unavailable"
            message={plans.error.message}
            actionLabel="Retry"
            onAction={() => void plans.refresh()}
          />
        ) : (
          <View style={styles.sectionContent}>
            <TouchableOpacity
              onPress={() => setEditing(null)}
              style={[styles.addButton, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.addButtonText, { color: colors.onAccent }]}>+ Add plan</Text>
            </TouchableOpacity>
            <View style={styles.planList}>
              {(plans.data ?? []).map((plan) => (
                <PlanRow key={plan.id} plan={plan} onPress={() => setEditing(plan)} />
              ))}
              {!plans.loading && (plans.data ?? []).length === 0 ? (
                <EmptyState title="No credit plans" message="Add the first purchasable plan." />
              ) : null}
            </View>
          </View>
        )}
      </AccordionSection>

      <PlanModal
        visible={editing !== undefined}
        plan={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSuccess={() => void plans.refresh()}
      />
    </ScrollView>
  );
}

function PlanRow({ plan, onPress }: { plan: CreditPlan; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.planRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.planRowMain}>
        <View style={styles.planRowTitleLine}>
          <Text numberOfLines={1} style={[styles.planRowTitle, { color: colors.text }]}>
            {plan.name}
          </Text>
          {plan.isHighlighted ? (
            <View style={[styles.smallBadge, { backgroundColor: colors.infoContainer }]}>
              <Text style={[styles.badgeText, { color: colors.info }]}>Highlighted</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.subtext, { color: colors.textSecondary }]}>
          {plan.subtext || plan.slug}
        </Text>
        <Text style={[styles.price, { color: colors.text }]}>
          {'\u20B9'}
          {(plan.basePaise / 100).toFixed(2)} Â· {plan.credits} credits
        </Text>
      </View>
      <View
        style={[
          styles.smallBadge,
          { backgroundColor: plan.isActive ? colors.successContainer : colors.surfaceVariant },
        ]}
      >
        <Text
          style={[styles.badgeText, { color: plan.isActive ? colors.success : colors.textMuted }]}
        >
          {plan.isActive ? 'Active' : 'Inactive'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function PlanModal({
  visible,
  plan,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  plan: CreditPlan | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { colors } = useAppTheme();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [subtext, setSubtext] = useState('');
  const [credits, setCredits] = useState('');
  const [priceRupees, setPriceRupees] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [badge, setBadge] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [queueStream, setQueueStream] = useState<CreditPlan['queueStream']>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(plan?.name ?? '');
    setSlug(plan?.slug ?? '');
    setSubtext(plan?.subtext ?? '');
    setCredits(plan ? String(plan.credits) : '');
    setPriceRupees(plan ? String(plan.basePaise / 100) : '');
    setSortOrder(plan ? String(plan.sortOrder) : '0');
    setBadge(plan?.badge ?? '');
    setIsActive(plan?.isActive ?? true);
    setIsHighlighted(plan?.isHighlighted ?? false);
    setQueueStream(plan?.queueStream ?? 'normal');
    setSlugEdited(Boolean(plan));
  }, [plan, visible]);

  function changeName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }
  async function submit() {
    const creditsValue = Number(credits);
    const priceValue = Number(priceRupees);
    const orderValue = Number(sortOrder) || 0;
    const isFreePlan = plan?.slug === 'free';
    if (
      !name.trim() ||
      !slug ||
      !/^[a-z0-9-]+$/.test(slug) ||
      !Number.isInteger(creditsValue) ||
      creditsValue < 0 ||
      !Number.isInteger(priceValue) ||
      priceValue < 0 ||
      (!isFreePlan && (creditsValue < 1 || priceValue < 1))
    )
      return Alert.alert(
        'Invalid plan',
        'Name, valid slug, and non-negative credits and price are required. Paid plans must stay above zero.',
      );
    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        slug,
        subtext: subtext.trim(),
        credits: creditsValue,
        basePaise: Math.round(priceValue * 100),
        sortOrder: orderValue,
        badge: badge.trim() || null,
        isActive,
        isHighlighted,
        queueStream,
      };
      await apiFetch(plan ? `/admin/credit-plans/${plan.id}` : '/admin/credit-plans', {
        method: plan ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      useToastStore
        .getState()
        .show(plan ? 'Credit plan updated' : 'Credit plan created', 'success');
      onClose();
      onSuccess();
    } catch (cause) {
      Alert.alert('Save failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function remove() {
    if (!plan) return;
    confirmAction({
      title: 'Delete credit plan?',
      message: 'Plans with existing payments cannot be deleted.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await apiFetch(`/admin/credit-plans/${plan.id}`, { method: 'DELETE' });
          useToastStore.getState().show('Credit plan deleted', 'success');
          onClose();
          onSuccess();
        } catch (cause) {
          const conflict = cause instanceof ApiError && cause.status === 409;
          Alert.alert(
            conflict ? 'Cannot delete' : 'Delete failed',
            conflict
              ? 'This plan has existing payments. Deactivate it instead.'
              : cause instanceof Error
                ? cause.message
                : 'Please try again.',
          );
        }
      },
    });
  }

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior="padding"
        style={[styles.modalRoot, { backgroundColor: colors.bg }]}
      >
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {plan ? 'Edit plan' : 'Add plan'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
            </TouchableOpacity>
          </View>
          <PlanField label="Name" value={name} onChangeText={changeName} />
          <PlanField
            label="Slug"
            value={slug}
            editable={!plan}
            onChangeText={(value) => {
              setSlugEdited(true);
              setSlug(slugify(value));
            }}
          />
          <PlanField label="Subtext" value={subtext} onChangeText={setSubtext} maxLength={200} />
          <PlanField label="Credits" value={credits} onChangeText={setCredits} numeric />
          <PlanField
            label="Price (â‚¹, excl. GST)"
            value={priceRupees}
            onChangeText={setPriceRupees}
            numeric
          />
          {Number(priceRupees) > 0 ? (
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              {'â‚¹'}
              {Number(priceRupees).toLocaleString('en-IN')} + 18% GST = {'â‚¹'}
              {(Number(priceRupees) * 1.18).toLocaleString('en-IN', {
                maximumFractionDigits: 2,
              })}
            </Text>
          ) : null}
          <PlanField label="Badge" value={badge} onChangeText={setBadge} maxLength={50} />
          <PlanField label="Sort order" value={sortOrder} onChangeText={setSortOrder} numeric />
          <View style={styles.field}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              Job Queue Priority
            </Text>
            <View style={styles.chipRow}>
              {(
                [
                  ['priority', '1st â€” Priority'],
                  ['normal', '2nd â€” Normal'],
                  ['low', '3rd â€” Low'],
                ] as const
              ).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  onPress={() => setQueueStream(value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        queueStream === value ? colors.accentContainer : colors.surfaceVariant,
                      borderColor: queueStream === value ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color:
                          queueStream === value ? colors.onAccentContainer : colors.textSecondary,
                      },
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Toggle label="Active" value={isActive} onChange={setIsActive} />
          <Toggle label="Highlighted" value={isHighlighted} onChange={setIsHighlighted} />
          <TouchableOpacity
            disabled={submitting}
            onPress={() => void submit()}
            style={[
              styles.saveButton,
              { backgroundColor: colors.accent },
              submitting && styles.disabled,
            ]}
          >
            <Text style={[styles.saveButtonText, { color: colors.onAccent }]}>
              {plan ? 'Save changes' : 'Create plan'}
            </Text>
          </TouchableOpacity>
          {plan && plan.slug !== 'free' ? (
            <TouchableOpacity
              onPress={remove}
              style={[styles.deleteButton, { borderColor: colors.error }]}
            >
              <Text style={[styles.deleteButtonText, { color: colors.error }]}>Delete plan</Text>
            </TouchableOpacity>
          ) : plan ? (
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>The free plan cannot be deleted.</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PlanField({
  label,
  value,
  onChangeText,
  numeric,
  maxLength,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  numeric?: boolean;
  maxLength?: number;
  editable?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        editable={editable}
        keyboardType={numeric ? 'number-pad' : 'default'}
        maxLength={maxLength}
        onChangeText={(value) => onChangeText(numeric ? value.replace(/\D/g, '') : value)}
        style={[
          styles.input,
          { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        value={value}
      />
    </View>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, gap: Spacing.lg, padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  header: {
    paddingVertical: Spacing.sm,
  },
  title: { ...Typography.h1 },
  sectionContent: { gap: Spacing.md, paddingTop: Spacing.sm },
  sectionLabel: { ...Typography.captionBold },
  chipRow: { flexDirection: 'row', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  chipText: { ...Typography.bodyBold },
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
  sliderSection: { gap: Spacing.sm },
  field: { gap: Spacing.sm },
  input: {
    minHeight: 50,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
    ...Typography.body,
  },
  addButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  addButtonText: { ...Typography.bodyBold },
  planList: { gap: Spacing.sm },
  planRow: {
    minHeight: 84,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  planRowMain: { flex: 1, minWidth: 0 },
  planRowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  planRowTitle: { ...Typography.bodyBold },
  subtext: { ...Typography.caption, marginTop: 2 },
  price: { ...Typography.captionBold, marginTop: Spacing.sm },
  smallBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  badgeText: { ...Typography.label },
  modalRoot: { flex: 1 },
  form: { gap: Spacing.lg, padding: Spacing.xl, paddingBottom: Spacing.xxxl },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { ...Typography.h2 },
  close: { ...Typography.bodyBold },
  saveButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  saveButtonText: { ...Typography.bodyBold },
  deleteButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  deleteButtonText: { ...Typography.bodyBold },
  disabled: { opacity: 0.5 },
});
