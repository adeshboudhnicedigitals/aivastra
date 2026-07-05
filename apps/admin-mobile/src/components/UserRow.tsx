import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatNumber, userInitials } from '../lib/format';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';
import type { User } from '../types';

export function UserRow({ user, onPress }: { user: User; onPress: () => void }) {
  const { colors } = useAppTheme();
  const tierBackground = user.tier === 'free' ? colors.surfaceVariant : colors.accentContainer;
  const tierText = user.tier === 'free' ? colors.textSecondary : colors.onAccentContainer;
  return (
    <TouchableOpacity
      accessibilityHint="Opens user details"
      accessibilityRole="button"
      activeOpacity={0.78}
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
        <Text style={[styles.initials, { color: colors.onAccent }]}>{userInitials(user)}</Text>
      </View>
      <View style={styles.identity}>
        <View style={styles.emailRow}>
          <Text numberOfLines={1} style={[styles.email, { color: colors.text }]}>
            {user.email}
          </Text>
          {user.isBanned ? (
            <Text style={[styles.banned, { color: colors.error }]}>Banned</Text>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.name, { color: colors.textSecondary }]}>
          {user.displayName || 'No display name'}
        </Text>
      </View>
      <View style={styles.meta}>
        <Text style={[styles.balance, { color: colors.text }]}>
          {formatNumber(user.balance)} cr
        </Text>
        <View style={[styles.tier, { backgroundColor: tierBackground }]}>
          <Text style={[styles.tierLabel, { color: tierText }]}>{user.tier}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  avatar: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  initials: { ...Typography.bodyBold },
  identity: { flex: 1, minWidth: 0 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  email: { ...Typography.bodyBold, flexShrink: 1 },
  banned: { ...Typography.label },
  name: { ...Typography.caption, marginTop: 2 },
  meta: { alignItems: 'flex-end', gap: 5 },
  balance: { ...Typography.captionBold, fontVariant: ['tabular-nums'] },
  tier: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  tierLabel: { ...Typography.label },
});
