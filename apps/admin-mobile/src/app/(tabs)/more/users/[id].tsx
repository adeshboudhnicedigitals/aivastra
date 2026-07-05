import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccordionSection } from '../../../../components/AccordionSection';
import { confirmAction } from '../../../../components/ConfirmDialog';
import { EmptyState } from '../../../../components/EmptyState';
import { GrantCreditsModal } from '../../../../components/GrantCreditsModal';
import { SkeletonLoader } from '../../../../components/SkeletonLoader';
import { StatusBadge } from '../../../../components/StatusBadge';
import { useApi } from '../../../../hooks/useApi';
import { ApiError, apiFetch } from '../../../../lib/api';
import { formatDate, formatNumber, userInitials } from '../../../../lib/format';
import { canManageUsers, isSuperAdmin as roleIsSuperAdmin } from '../../../../lib/roles';
import { useAuthStore } from '../../../../store/auth';
import { useAppTheme } from '../../../../store/theme';
import { useToastStore } from '../../../../store/toast';
import { Radius, Spacing, TabBarClearance, Typography } from '../../../../styles/tokens';
import type { User } from '../../../../types';

export default function UserDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);
  const { data: user, loading, error, refresh } = useApi<User>(`/admin/users/${id}`);
  const [grantVisible, setGrantVisible] = useState(false);
  const [actioning, setActioning] = useState(false);
  const canWrite = canManageUsers(role);
  const superAdmin = roleIsSuperAdmin(role);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function runPatch(body: {
    isBanned: boolean;
    banReason: string | null;
    forceLogout?: boolean;
  }) {
    setActioning(true);
    try {
      await apiFetch<{ ok: boolean }>(`/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      await refresh();
      useToastStore.getState().show('User updated', 'success');
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setActioning(false);
    }
  }

  async function toggleAdmin() {
    if (!user) return;
    if (user.isAdmin) {
      confirmAction({
        title: 'Revoke admin?',
        message: `Remove admin access for ${user.email}?`,
        confirmLabel: 'Revoke',
        destructive: true,
        onConfirm: async () => {
          setActioning(true);
          try {
            await apiFetch(`/admin/admin-users/${id}`, { method: 'DELETE' });
            await refresh();
            useToastStore.getState().show('Admin access revoked', 'success');
          } catch (cause) {
            Alert.alert('Failed', cause instanceof Error ? cause.message : 'Please try again.');
          } finally {
            setActioning(false);
          }
        },
      });
    } else {
      confirmAction({
        title: 'Grant admin?',
        message: `Grant admin access to ${user.email}?`,
        confirmLabel: 'Grant Admin',
        onConfirm: async () => {
          setActioning(true);
          try {
            await apiFetch('/admin/admin-users', {
              method: 'POST',
              body: JSON.stringify({ userId: id }),
            });
            await refresh();
            useToastStore.getState().show('Admin access granted', 'success');
          } catch (cause) {
            Alert.alert('Failed', cause instanceof Error ? cause.message : 'Please try again.');
          } finally {
            setActioning(false);
          }
        },
      });
    }
  }

  function toggleBan() {
    if (!user) return;
    if (user.isBanned)
      confirmAction({
        title: 'Unban user?',
        message: 'This user will be able to sign in and create jobs again.',
        confirmLabel: 'Unban',
        onConfirm: () => runPatch({ isBanned: false, banReason: null }),
      });
    else
      confirmAction({
        title: 'Ban user?',
        message: 'This will revoke all active sessions.',
        confirmLabel: 'Ban',
        destructive: true,
        onConfirm: () => runPatch({ isBanned: true, banReason: 'admin ban', forceLogout: true }),
      });
  }
  function deleteUser() {
    confirmAction({
      title: 'Delete user?',
      message: 'This soft-deletes the account and revokes all active sessions.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        setActioning(true);
        try {
          await apiFetch<{ ok: boolean }>(`/admin/users/${id}`, { method: 'DELETE' });
          if (mounted.current) {
            useToastStore.getState().show('User deleted', 'success');
            router.back();
          }
        } catch (cause) {
          if (mounted.current) {
            Alert.alert(
              'Delete failed',
              cause instanceof Error ? cause.message : 'Please try again.',
            );
          }
        } finally {
          if (mounted.current) {
            setActioning(false);
          }
        }
      },
    });
  }

  if (loading && !user)
    return (
      <ScrollView contentContainerStyle={[styles.loading, { backgroundColor: colors.bg }]}>
        <SkeletonLoader count={3} variant="detail" />
      </ScrollView>
    );
  if (error && !user)
    return (
      <EmptyState
        actionLabel={error instanceof ApiError && error.status === 404 ? undefined : 'Retry'}
        message={
          error instanceof ApiError && error.status === 404
            ? 'This user does not exist or has been deleted.'
            : error.message
        }
        onAction={
          error instanceof ApiError && error.status === 404 ? undefined : () => void refresh()
        }
        title="User not found"
      />
    );
  if (!user?.id || !user.email)
    return (
      <EmptyState
        actionLabel="Retry"
        message="The user record could not be loaded."
        onAction={() => void refresh()}
        title="User not found"
      />
    );
  const tierBackground = user.tier === 'free' ? colors.surfaceVariant : colors.accentContainer;

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { backgroundColor: colors.bg, paddingBottom: bottom + TabBarClearance },
        ]}
      >
        <View
          style={[styles.profile, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.profileHeader}>
            <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
              <Text style={[styles.initials, { color: colors.onAccent }]}>
                {userInitials(user)}
              </Text>
            </View>
            <View style={styles.identity}>
              <Text numberOfLines={2} style={[styles.email, { color: colors.text }]}>
                {user.email}
              </Text>
              <Text style={[styles.name, { color: colors.textSecondary }]}>
                {user.displayName || 'No display name'}
              </Text>
            </View>
          </View>
          <View style={styles.chips}>
            <Chip
              background={tierBackground}
              color={user.tier === 'free' ? colors.textSecondary : colors.onAccentContainer}
              label={user.tier}
            />
            {user.isAdmin ? (
              <Chip
                background={colors.infoContainer}
                color={colors.info}
                label={user.adminRole ?? 'ADMIN'}
              />
            ) : null}
            {user.isBanned ? (
              <Chip background={colors.errorContainer} color={colors.error} label="BANNED" />
            ) : null}
          </View>
          <View style={styles.metrics}>
            <Metric
              color={colors.text}
              label="Balance"
              secondary={colors.textMuted}
              value={`${formatNumber(user.balance)} cr`}
            />
            <Metric
              color={colors.text}
              label="Total jobs"
              secondary={colors.textMuted}
              value={formatNumber(user.totalJobs)}
            />
            <Metric
              color={colors.text}
              label="Member since"
              secondary={colors.textMuted}
              value={formatDate(user.createdAt).split(',')[0] ?? formatDate(user.createdAt)}
            />
          </View>
          {user.isBanned && user.banReason ? (
            <View style={[styles.banReason, { backgroundColor: colors.errorContainer }]}>
              <Text style={[styles.banText, { color: colors.error }]}>
                Reason: {user.banReason}
              </Text>
            </View>
          ) : null}
        </View>

        <AccordionSection title="Recent Jobs">
          {user.recentJobs?.length ? (
            <View style={styles.jobList}>
              {user.recentJobs.map((job) => (
                <TouchableOpacity
                  key={job.id}
                  onPress={() => router.push(`/(tabs)/jobs/${job.id}`)}
                  style={[styles.jobRow, { borderBottomColor: colors.border }]}
                >
                  <StatusBadge status={job.status} />
                  <Text style={[styles.jobDate, { color: colors.textSecondary }]}>
                    {formatDate(job.createdAt)}
                  </Text>
                  <MaterialCommunityIcons color={colors.textMuted} name="chevron-right" size={20} />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No jobs yet</Text>
          )}
        </AccordionSection>

        {canWrite ? (
          <View
            style={[
              styles.actionsCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.actionsTitle, { color: colors.text }]}>Actions</Text>

            {superAdmin ? (
              <TouchableOpacity
                disabled={actioning}
                onPress={toggleAdmin}
                style={[
                  styles.action,
                  {
                    backgroundColor: user.isAdmin ? colors.errorContainer : colors.infoContainer,
                  },
                ]}
              >
                {actioning ? (
                  <ActivityIndicator color={user.isAdmin ? colors.error : colors.info} />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      color={user.isAdmin ? colors.error : colors.info}
                      name={user.isAdmin ? 'account-lock-outline' : 'account-key-outline'}
                      size={20}
                    />
                    <Text
                      style={[
                        styles.actionLabel,
                        { color: user.isAdmin ? colors.error : colors.info },
                      ]}
                    >
                      {user.isAdmin ? 'Revoke Admin' : 'Grant Admin'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              disabled={actioning}
              onPress={() => setGrantVisible(true)}
              style={[styles.action, { backgroundColor: colors.accent }]}
            >
              <MaterialCommunityIcons
                color={colors.onAccent}
                name="plus-circle-outline"
                size={20}
              />
              <Text style={[styles.actionLabel, { color: colors.onAccent }]}>Grant Credits</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={actioning || user.isAdmin}
              onPress={toggleBan}
              style={[
                styles.action,
                {
                  backgroundColor: user.isBanned ? colors.successContainer : colors.errorContainer,
                },
                user.isAdmin && styles.disabled,
              ]}
            >
              {actioning ? (
                <ActivityIndicator color={user.isBanned ? colors.success : colors.error} />
              ) : (
                <>
                  <MaterialCommunityIcons
                    color={user.isBanned ? colors.success : colors.error}
                    name={user.isBanned ? 'account-check-outline' : 'account-cancel-outline'}
                    size={20}
                  />
                  <Text
                    style={[
                      styles.actionLabel,
                      { color: user.isBanned ? colors.success : colors.error },
                    ]}
                  >
                    {user.isBanned ? 'Unban User' : 'Ban User'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            {superAdmin ? (
              <TouchableOpacity
                disabled={actioning || user.isAdmin}
                onPress={deleteUser}
                style={[
                  styles.deleteAction,
                  { borderColor: colors.error },
                  user.isAdmin && styles.disabled,
                ]}
              >
                <MaterialCommunityIcons color={colors.error} name="delete-outline" size={20} />
                <Text style={[styles.actionLabel, { color: colors.error }]}>Delete User</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <GrantCreditsModal
        onClose={() => setGrantVisible(false)}
        onSuccess={() => {
          void refresh();
          useToastStore.getState().show('Credits granted', 'success');
        }}
        userEmail={user.email}
        userId={user.id}
        visible={grantVisible}
      />
    </>
  );
}

function Chip({ label, background, color }: { label: string; background: string; color: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: background }]}>
      <Text style={[styles.chipLabel, { color }]}>{label}</Text>
    </View>
  );
}
function Metric({
  label,
  value,
  color,
  secondary,
}: {
  label: string;
  value: string;
  color: string;
  secondary: string;
}) {
  return (
    <View style={styles.metric}>
      <Text numberOfLines={1} style={[styles.metricValue, { color }]}>
        {value}
      </Text>
      <Text style={[styles.metricLabel, { color: secondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.lg },
  loading: { padding: Spacing.lg },
  profile: { padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.xl, gap: Spacing.lg },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  initials: { ...Typography.h3 },
  identity: { flex: 1 },
  email: { ...Typography.h3 },
  name: { ...Typography.body, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 5, borderRadius: Radius.full },
  chipLabel: { ...Typography.label },
  metrics: { flexDirection: 'row', gap: Spacing.sm },
  metric: { flex: 1, minWidth: 0 },
  metricValue: { ...Typography.bodyBold, fontVariant: ['tabular-nums'] },
  metricLabel: { ...Typography.caption, marginTop: 2 },
  banReason: { padding: Spacing.md, borderRadius: Radius.md },
  banText: { ...Typography.captionBold },
  jobList: { gap: 0 },
  jobRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  jobDate: { ...Typography.caption, flex: 1, textAlign: 'right' },
  emptyText: { ...Typography.body },
  actionsCard: { padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.xl, gap: Spacing.md },
  actionsTitle: { ...Typography.h3 },
  action: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.full,
  },
  deleteAction: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  actionLabel: { ...Typography.bodyBold },
  disabled: { opacity: 0.4 },
});
