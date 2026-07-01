import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '../../../lib/api';
import { canAccessAssets, canManageTryonSaree, isSuperAdmin } from '../../../lib/roles';
import { useAuthStore } from '../../../store/auth';
import { type ThemeMode, useAppTheme, useThemeStore } from '../../../store/theme';
import { Radius, Spacing, Typography } from '../../../styles/tokens';

const ITEMS = [
  ['Contacts', 'message-alert-outline'],
  ['Users', 'account-group-outline'],
  ['Workflows', 'transit-connection-variant'],
  ['Try-on', 'swap-horizontal-bold'],
  ['Saree', 'hanger'],
  ['Widget Clients', 'widgets-outline'],
  ['Recycle Bin', 'delete-restore'],
  ['Workers', 'server-network'],
  ['Settings', 'cog-outline'],
  ['Config', 'tune-variant'],
] as const;

const ROUTES = {
  Contacts: '/(tabs)/more/contacts',
  Users: '/(tabs)/more/users',
  Workflows: '/(tabs)/more/workflows',
  'Try-on': '/(tabs)/more/tryon',
  Saree: '/(tabs)/more/saree',
  'Widget Clients': '/(tabs)/more/widget-clients',
  'Recycle Bin': '/(tabs)/more/recycle-bin',
  Workers: '/(tabs)/more/workers',
  Settings: '/(tabs)/more/settings',
  Config: '/(tabs)/more/config',
} as const;

export default function MoreScreen() {
  const router = useRouter();
  const role = useAuthStore((state) => state.role);
  const logout = useAuthStore((state) => state.logout);
  const email = useAuthStore((state) => state.email);
  const { colors, mode } = useAppTheme();
  const setMode = useThemeStore((state) => state.setMode);
  const { bottom } = useSafeAreaInsets();
  const [contactBadge, setContactBadge] = useState(0);

  useEffect(() => {
    const fetchCount = () =>
      apiFetch<{ count: number }>('/admin/contact-requests/unread-count')
        .then(({ count }) => setContactBadge(count))
        .catch(() => {});
    void fetchCount();
    const t = setInterval(fetchCount, 5_000);
    return () => clearInterval(t);
  }, []);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.root,
        { backgroundColor: colors.bg, paddingBottom: bottom + 100 },
      ]}
    >
      <View style={[styles.profile, { backgroundColor: colors.accentContainer }]}>
        <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
          <MaterialCommunityIcons color={colors.onAccent} name="shield-account" size={28} />
        </View>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.email, { color: colors.onAccentContainer }]}>
            {email}
          </Text>
          <Text style={[styles.role, { color: colors.onAccentContainer }]}>
            {role ?? 'Unknown'} administrator
          </Text>
        </View>
      </View>
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>APPEARANCE</Text>
      <View style={[styles.segment, { backgroundColor: colors.surfaceVariant }]}>
        {(['system', 'light', 'dark'] as ThemeMode[]).map((item) => (
          <TouchableOpacity
            key={item}
            onPress={() => void setMode(item)}
            style={[styles.segmentButton, mode === item && { backgroundColor: colors.surface }]}
          >
            <MaterialCommunityIcons
              color={mode === item ? colors.accent : colors.textMuted}
              name={
                item === 'system'
                  ? 'cellphone-cog'
                  : item === 'light'
                    ? 'white-balance-sunny'
                    : 'moon-waning-crescent'
              }
              size={18}
            />
            <Text
              style={[
                styles.segmentText,
                { color: mode === item ? colors.text : colors.textMuted },
              ]}
            >
              {item}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>ADMIN TOOLS</Text>
      <View style={styles.menu}>
        {ITEMS.map(([label, icon]) => {
          const disabled =
            ((label === 'Settings' || label === 'Config') && !isSuperAdmin(role)) ||
            ((label === 'Try-on' || label === 'Saree') && !canManageTryonSaree(role)) ||
            ((label === 'Workflows' ||
              label === 'Recycle Bin' ||
              label === 'Workers' ||
              label === 'Widget Clients') &&
              !canAccessAssets(role));
          const badge = label === 'Contacts' ? contactBadge : 0;
          return (
            <TouchableOpacity
              key={label}
              disabled={disabled}
              onPress={() => {
                const route = ROUTES[label as keyof typeof ROUTES];
                if (route) router.push(route);
              }}
              style={[
                styles.item,
                { backgroundColor: colors.surface, borderColor: colors.border },
                disabled && styles.disabled,
              ]}
            >
              <View style={[styles.itemIcon, { backgroundColor: colors.surfaceVariant }]}>
                <MaterialCommunityIcons color={colors.accent} name={icon} size={21} />
              </View>
              <Text style={[styles.itemText, { color: colors.text }]}>{label}</Text>
              {badge > 0 ? (
                <View style={[styles.itemBadge, { backgroundColor: colors.error }]}>
                  <Text style={styles.itemBadgeText}>{badge}</Text>
                </View>
              ) : null}
              <MaterialCommunityIcons color={colors.textMuted} name="chevron-right" size={22} />
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity
        onPress={() => void logout()}
        style={[styles.logout, { backgroundColor: colors.errorContainer }]}
      >
        <MaterialCommunityIcons color={colors.error} name="logout" size={20} />
        <Text style={[styles.logoutText, { color: colors.error }]}>Log out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  root: { flexGrow: 1, padding: Spacing.lg, gap: Spacing.lg },
  flex: { flex: 1 },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.xl,
  },
  avatar: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
  },
  email: { ...Typography.bodyBold },
  role: { ...Typography.caption, marginTop: 2, opacity: 0.76 },
  sectionLabel: { ...Typography.label, marginTop: Spacing.sm },
  segment: { flexDirection: 'row', padding: 4, borderRadius: Radius.full },
  segmentButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.full,
  },
  segmentText: { ...Typography.captionBold, textTransform: 'capitalize' },
  menu: { gap: Spacing.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 64,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  itemIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  itemText: { ...Typography.bodyBold, flex: 1 },
  itemBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  itemBadgeText: { ...Typography.label, color: '#fff' },
  disabled: { opacity: 0.4 },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: Radius.full,
    marginTop: 'auto',
  },
  logoutText: { ...Typography.bodyBold },
});
